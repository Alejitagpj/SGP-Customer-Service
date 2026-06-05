import sgpApi from '../lib/supabase';
import type { Product } from '../types';

const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY || '';

async function callOpenAI(prompt: string) {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400
      })
    });
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error('OpenAI call failed', err);
    return null;
  }
}

export default {
  async getRecommendations(context?: { search?: string; lastOrders?: string[] }) {
    // Try OpenAI first
    const prompt = `Suggest 3 product IDs from the menu for the customer. Context: ${JSON.stringify(context || {})}`;
    const openaiResp = await callOpenAI(prompt);
    if (openaiResp) {
      // Expect comma separated ids
      const ids = openaiResp.split(/\s|,|\n/).filter(Boolean).slice(0, 5);
      const { data } = await sgpApi.getProducts();
      const products = (data || []) as Product[];
      return products.filter(p => ids.includes(p.id)).slice(0, 3);
    }

    // Fallback: simple heuristic - return top 3 available products from menu
    const { data } = await sgpApi.getProducts();
    const products = (data || []) as Product[];
    return products
      .filter(p => p.is_available)
      .slice(0, 3);
  },

  async chatAssistant(message: string) {
    // If OpenAI is available, forward the message
    const openaiResp = await callOpenAI(message);
    if (openaiResp) return openaiResp;

    // Naive local assistant: simple intents
    const lower = message.toLowerCase();
    if (lower.includes('recom') || lower.includes('suger')) {
      const recs = await this.getRecommendations({ search: message });
      return `Te recomiendo: ${recs.map(r => r.name).join(', ')}`;
    }
    if (lower.includes('sin') || lower.includes('alerg')) {
      return 'Puedo filtrar el menú por alergias o preferencias. Dime qué ingredientes evitar.';
    }
    if (lower.includes('tiempo') || lower.includes('prepar')) {
      return 'Tiempos estimados: la mayoría de platos entre 8-20 minutos. Puedo predecir tiempos cuando hay más contexto.';
    }
    return "Lo siento, no entendí. Prueba pedir una recomendación o decir 'recomiéndame'";
  },

  // Kitchen helpers (mocked)
  async predictPrepTimes(orders: any[]) {
    // Return estimated minutes per order item
    return orders.map(o => ({ orderId: o.id, etaMinutes: 10 + (o.items?.length || 1) * 3 }));
  },

  async summarizeOrders(orders: any[]) {
    // Simple summary: counts per product
    const counts: Record<string, number> = {};
    orders.forEach(o => {
      (o.items || []).forEach((it: any) => {
        counts[it.product_name || it.product_id] = (counts[it.product_name || it.product_id] || 0) + (it.quantity || 0);
      });
    });
    return Object.entries(counts)
      .map(([k, v]) => `${v} x ${k}`)
      .join('\n');
  }
};
