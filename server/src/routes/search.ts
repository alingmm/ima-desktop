import { Router } from 'express';
import { SearchClient, Config, HeaderUtils, LLMClient } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router: import("express").Router = Router();
const config = new Config();

// Basic web search
router.post('/web', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { query, count = 10, needSummary = true, timeRange, sites } = req.body;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const client = new SearchClient(config, customHeaders);

    let response;

    if (timeRange || sites) {
      response = await client.advancedSearch(query, {
        count,
        needSummary,
        timeRange,
        sites,
      });
    } else {
      response = await client.webSearch(query, count, needSummary);
    }

    // Save search history
    try {
      const supabase = getSupabaseClient();
      await supabase.from('search_history').insert({
        id: uuidv4(),
        user_id: req.userId,
        query,
        result_count: response.web_items?.length || 0,
      });
    } catch (saveError) {
      console.error('Save search history error:', saveError);
    }

    res.json({
      summary: response.summary,
      results: (response.web_items || []).map(item => ({
        id: item.id,
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        site_name: item.site_name,
        publish_time: item.publish_time,
        logo_url: item.logo_url,
        rank_score: item.rank_score,
        auth_info_des: item.auth_info_des,
        auth_info_level: item.auth_info_level,
      })),
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Image search
router.post('/images', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { query, count = 10 } = req.body;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const client = new SearchClient(config, customHeaders);

    const response = await client.imageSearch(query, count);

    res.json({
      results: (response.image_items || []).map(item => ({
        id: item.id,
        title: item.title,
        url: item.url,
        site_name: item.site_name,
        image: item.image,
        publish_time: item.publish_time,
      })),
    });
  } catch (error) {
    console.error('Image search error:', error);
    res.status(500).json({ error: 'Image search failed' });
  }
});

// AI summary of search results
router.post('/summarize', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { query, results } = req.body;

    if (!query || !results) {
      res.status(400).json({ error: 'Query and results are required' });
      return;
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const client = new LLMClient(config, customHeaders);

    const context = results
      .slice(0, 5)
      .map((r: { title: string; snippet: string }, i: number) => `[${i + 1}] ${r.title}\n${r.snippet}`)
      .join('\n\n');

    const prompt = `请根据以下搜索结果，用中文为用户的问题"${query}"生成一份结构化的AI总结：

搜索结果：
${context}

要求：
1. 总结要准确、全面，基于搜索结果
2. 分点列出关键信息
3. 标注信息来源（引用序号）
4. 如果搜索结果中有不同观点，客观呈现
5. 不编造搜索结果中没有的信息`;

    const response = await client.invoke(
      [{ role: 'user', content: prompt }],
      { temperature: 0.5 }
    );

    res.json({ summary: response.content });
  } catch (error) {
    console.error('Summarize error:', error);
    res.status(500).json({ error: 'Summary generation failed' });
  }
});

// Get search history
router.get('/history', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('search_history')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ history: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get search history' });
  }
});

// Delete search history
router.delete('/history/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('search_history')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete search history' });
  }
});

export default router;
