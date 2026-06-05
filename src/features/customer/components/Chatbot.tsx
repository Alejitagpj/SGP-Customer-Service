import React, { useState } from 'react';
import aiService from '../../../services/aiService';
import sgpApi from '../../../lib/supabase';
import { Plus, MessageSquare } from 'lucide-react';
import { useApp } from '../../../context/AppContext';

const Chatbot: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ from: string; text: string }>>([]);
  const { addToCart, submitCartOrder, cart } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [confirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [orderSummary, setOrderSummary] = useState<{ lines: string[]; subtotal: number } | null>(null);
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);

  const askRecs = async () => {
    const recs = await aiService.getRecommendations();
    setMessages(m => [...m, { from: 'assistant', text: 'Recomendaciones: ' + recs.map(r => r.name).join(', ') }]);
  };

  const estimateOrderTime = (items: any[]) => {
    const totalItems = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
    const estimate = 8 + totalItems * 3;
    return Math.min(Math.max(estimate, 8), 35);
  };

  const parseDietaryPreferences = (text: string) => {
    const normalized = text.toLowerCase();
    const prefs: Array<{
      label: string;
      excludeIngredients: string[];
      excludeTerms: string[];
    }> = [];

    if (/(sin gluten|libre de gluten|gluten free)/.test(normalized)) {
      prefs.push({
        label: 'sin gluten',
        excludeIngredients: ['trigo', 'harina', 'pan', 'masa', 'bizcocho', 'galleta', 'pasta', 'spaghetti', 'fideo', 'pizza', 'cerveza', 'cervesa'],
        excludeTerms: ['gluten', 'sin gluten', 'gluten free']
      });
    }

    if (/(sin lim[oó]n|no lim[oó]n|libre de lim[oó]n|lim[oó]n libre|sin limon|no limon|libre de limon)/.test(normalized)) {
      prefs.push({
        label: 'sin limón',
        excludeIngredients: ['limón', 'limon', 'lime', 'cítrico', 'citron'],
        excludeTerms: ['limón', 'limon', 'lime']
      });
    }

    if (/(keto|cetog[eé]nico|bajo en carbohidratos|low carb|low-carb|sin carbohidratos|bajo carbohidratos)/.test(normalized)) {
      prefs.push({
        label: 'opciones keto',
        excludeIngredients: ['arroz', 'papas', 'patata', 'pan', 'masa', 'camote', 'quinoa', 'fideo', 'pasta', 'tortilla', 'galleta', 'bizcocho', 'helado', 'miel', 'azúcar', 'azucar', 'jarabe'],
        excludeTerms: ['arroz', 'pan', 'pasta', 'helado', 'bizcocho', 'galleta', 'azúcar', 'azucar', 'miel']
      });
    }

    return prefs;
  };

  const filterProductsByDiet = (products: any[], prefs: Array<{ label: string; excludeIngredients: string[]; excludeTerms: string[] }>) => {
    if (!prefs || prefs.length === 0) return products;
    return products.filter(product => {
      const nameDesc = `${product.name} ${product.description}`.toLowerCase();
      const ingredients = (product.ingredients || []).map((ing: string) => ing.toLowerCase());

      return prefs.every(pref => {
        const hasExcludedIngredient = pref.excludeIngredients.some(exclude =>
          ingredients.some((ing: string) => ing.includes(exclude))
        );
        const hasExcludedTerm = pref.excludeTerms.some(term => nameDesc.includes(term));
        return !hasExcludedIngredient && !hasExcludedTerm;
      });
    });
  };

  const stripDietTerms = (text: string) => {
    return text
      .replace(/sin gluten|libre de gluten|gluten free|sin lim[oó]n|no lim[oó]n|libre de lim[oó]n|lim[oó]n libre|sin limon|no limon|libre de limon|keto|cetog[eé]nico|bajo en carbohidratos|low carb|low-carb|sin carbohidratos|bajo carbohidratos/gi, '')
      .trim();
  };

  const handleSendOrder = async () => {
    if (!orderSummary) return;

    setIsSending(true);
    try {
      const order = await submitCartOrder('Enviado desde Chatbot');
      if (order) {
        const lines = (order.items || []).map((it: any) => `${it.quantity}x ${it.product_name || it.product_id} — $${(it.unit_price * it.quantity).toFixed(2)}`);
        const total = order.total_amount || 0;
        const sentSummary = `Pedido enviado (ID: ${order.id}):\n${lines.join('\n')}\nTotal: $${total.toFixed(2)}`;
        setMessages(m => [...m, { from: 'assistant', text: sentSummary }]);
        setConfirmationModalOpen(false);
        setOrderSummary(null);
        setEstimateMinutes(null);
        setOpen(false);
      } else {
        setMessages(m => [...m, { from: 'assistant', text: 'Pedido enviado correctamente. ¡Gracias!' }]);
      }
    } catch (err: any) {
      setMessages(m => [...m, { from: 'assistant', text: `Error al enviar: ${err?.message || err}` }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleQuery = async (q: string) => {
    setQuery(q);
    if (!q || q.trim().length === 0) {
      setResults([]);
      return;
    }

    const dietPreferences = parseDietaryPreferences(q);
    const searchPhrase = stripDietTerms(q);

    setMessages(m => [...m, {
      from: 'assistant',
      text: dietPreferences.length > 0
        ? `Buscando opciones ${dietPreferences.map(pref => pref.label).join(' y ')}...`
        : `Buscando opciones para “${q}”...`
    }]);

    const { data: prods } = await sgpApi.getProducts();
    const filtered = (prods || []).filter((p: any) => {
      const text = `${p.name} ${p.description}`.toLowerCase();
      if (searchPhrase.length === 0) {
        return true;
      }
      return text.includes(searchPhrase.toLowerCase()) ||
        (p.ingredients || []).some((ing: string) => ing.toLowerCase().includes(searchPhrase.toLowerCase()));
    });

    const dietFiltered = filterProductsByDiet(filtered, dietPreferences);

    if (dietFiltered.length === 0) {
      setMessages(m => [...m, {
        from: 'assistant',
        text: dietPreferences.length > 0
          ? 'No hay resultados que cumplan esas restricciones. Intenta otra preferencia o prueba otra descripción.'
          : `No encuentro opciones exactas para “${q}”. Prueba con una descripción más amplia o selecciona una categoría.`
      }] );
      setResults([]);
      return;
    }

    setResults(dietFiltered.slice(0, 8));
    setMessages(m => [...m, {
      from: 'assistant',
      text: dietPreferences.length > 0
        ? `Aquí tienes algunas sugerencias ${dietPreferences.map(pref => pref.label).join(' y ')}.`
        : `Aquí tienes algunas sugerencias para “${q}”.`
    }]);
  };

  const processUserInput = async (text: string) => {
    const t = text.trim().toLowerCase();

    // If confirmation modal is already open and user responds yes/no
    const acceptedYes = ['si', 'sí', 's', 'yes', 'y', 'confirmar'];
    const acceptedNo = ['no', 'n', 'cancelar', 'negativo'];
    if (confirmationModalOpen) {
      if (acceptedYes.includes(t)) {
        await handleSendOrder();
      } else if (acceptedNo.includes(t)) {
        setMessages(m => [...m, { from: 'assistant', text: 'Perfecto, no enviaré el pedido por ahora.' }]);
        setConfirmationModalOpen(false);
      }
      return;
    }

    // Detect explicit confirm/send intent
    const confirmKeywords = ['confirm', 'confirmar', 'enviar', 'envia', 'terminar', 'finalizar', 'mandar'];
    const hasConfirm = confirmKeywords.some(k => t.includes(k));

    if (hasConfirm) {
      if (!cart || cart.length === 0) {
        setMessages(m => [...m, { from: 'assistant', text: 'Tu carrito está vacío. Agrega productos antes de confirmar.' }]);
        return;
      }

      const lines = cart.map(item => `${item.quantity}x ${item.product.name} — $${(item.product.price * item.quantity).toFixed(2)}`);
      const subtotal = cart.reduce((s, it) => s + it.product.price * it.quantity, 0);
      const eta = estimateOrderTime(cart);

      setOrderSummary({ lines, subtotal });
      setEstimateMinutes(eta);
      setConfirmationModalOpen(true);
      setMessages(m => [...m, { from: 'assistant', text: 'He preparado tu resumen de pedido. Confirma si quieres que lo envíe.' }]);
      return;
    }

    // Default: perform search
    await handleQuery(text);
  };


  const handleAdd = (product: any) => {
    addToCart(product, 1, '');
    setMessages(m => [...m, { from: 'assistant', text: `Agregado ${product.name} al carrito.` }]);
  };

  return (
    <div>
      {open && (
        <div className="fixed bottom-20 left-4 right-4 sm:right-4 sm:left-auto w-auto sm:w-96 bg-white dark:bg-neutral-900 border rounded-2xl shadow-lg p-3 z-50">
          <div className="flex justify-between items-center mb-2">
            <strong>Asistente</strong>
            <button onClick={() => setOpen(false)} className="text-sm">Cerrar</button>
          </div>

          <div className="mb-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setMessages(m => [...m, { from: 'user', text: query }]); processUserInput(query); setQuery(''); } }}
              placeholder="Escribe tu pregunta o pedido... (ej. 'sin gluten', 'rápido', 'pollo')"
              className="w-full px-3 py-2 rounded-lg border bg-slate-50 dark:bg-neutral-800 text-sm"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setMessages(m => [...m, { from: 'user', text: query }]); processUserInput(query); setQuery(''); }} className="flex-1 bg-brand-500 text-white rounded-lg py-2">Buscar</button>
              <button onClick={() => askRecs()} className="px-3 rounded-lg border">Sugerir</button>
            </div>
          </div>

          <div className="max-h-56 overflow-auto text-sm mb-2">
            {messages.map((m, i) => (
              <div key={i} className={`mb-2 ${m.from === 'assistant' ? 'text-slate-700' : 'text-slate-900'}`}>
                <div className="text-xs font-semibold">{m.from}</div>
                <div>{m.text}</div>
              </div>
            ))}
          </div>

          {results.length > 0 && (
            <div className="space-y-2">
              {results.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between bg-slate-50 dark:bg-neutral-800 rounded-lg p-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{p.name}</div>
                    <div className="text-xs text-slate-500 truncate">${p.price?.toFixed?.(2) || p.price}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleAdd(p)} className="bg-brand-500 text-white px-3 py-1 rounded-lg text-xs flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> Agregar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmationModalOpen && orderSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-lg rounded-[32px] border border-slate-200/70 bg-white text-slate-900 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 dark:text-slate-100 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-200/70 dark:border-neutral-800">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold">Confirmar envío</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Revisa tu pedido y confirma para enviarlo a cocina.</p>
                </div>
                <button
                  onClick={() => setConfirmationModalOpen(false)}
                  className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  aria-label="Cerrar modal"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="rounded-3xl bg-slate-50 dark:bg-neutral-900 p-4">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Resumen del pedido</p>
                <div className="space-y-2 text-sm">
                  {orderSummary.lines.map((line, idx) => (
                    <div key={idx} className="flex justify-between gap-3">
                      <span className="truncate">{line}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-slate-200/70 dark:border-neutral-800 pt-3 flex items-center justify-between text-sm font-semibold">
                  <span>Total estimado</span>
                  <span>${orderSummary.subtotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="rounded-3xl bg-brand-500/10 border border-brand-500/20 p-4 text-brand-900 dark:bg-brand-500/20 dark:text-brand-100">
                <p className="text-sm font-semibold">Tiempo estimado de preparación</p>
                <p className="mt-1 text-xl font-bold">{estimateMinutes} min</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">El pedido se envía a cocina tan pronto lo confirmes.</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200/70 dark:border-neutral-800 px-6 py-4 sm:flex-row sm:justify-end">
              <button
                onClick={() => setConfirmationModalOpen(false)}
                className="rounded-3xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-neutral-700 dark:text-slate-200 dark:hover:bg-neutral-900"
              >
                No enviar
              </button>
              <button
                onClick={handleSendOrder}
                disabled={isSending}
                className="rounded-3xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSending ? 'Enviando...' : 'Confirmar y enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-4 right-4 w-14 h-14 rounded-full bg-brand-500 text-white flex items-center justify-center shadow-lg z-50"
        aria-label="Chatbot"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    </div>
  );
};

export default Chatbot;
