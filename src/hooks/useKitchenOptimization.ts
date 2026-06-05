import { useEffect, useState, useCallback } from 'react';
import sgpApi from '../lib/supabase';
import aiService from '../services/aiService';
import { getInventory, restockIngredient } from '../services/mockData';

export default function useKitchenOptimization(storeId?: string) {
  const [orders, setOrders] = useState<any[]>([]);
  const [predictions, setPredictions] = useState<any[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [lowStock, setLowStock] = useState<Record<string, number>>({});

  const loadOrders = useCallback(async () => {
    if (!storeId) return;
    const { data } = await sgpApi.getActiveStoreOrders(storeId);
    setOrders(data || []);
  }, [storeId]);

  const refreshPredictions = useCallback(async () => {
    if (!orders || orders.length === 0) {
      setPredictions([]);
      setSummary('');
      return;
    }
    const preds = await aiService.predictPrepTimes(orders);
    setPredictions(preds || []);
    const summ = await aiService.summarizeOrders(orders);
    setSummary(summ || '');
  }, [orders]);

  const checkLowStock = useCallback((threshold = 5) => {
    const inv = getInventory();
    const low: Record<string, number> = {};
    Object.entries(inv).forEach(([k, v]) => {
      if (v <= threshold) low[k] = v;
    });
    setLowStock(low);
    return low;
  }, []);

  useEffect(() => {
    loadOrders();
    checkLowStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOrders]);

  useEffect(() => {
    refreshPredictions();
  }, [orders, refreshPredictions]);

  const restock = (ingredient: string, amount: number) => {
    restockIngredient(ingredient, amount);
    checkLowStock();
  };

  return {
    orders,
    loadOrders,
    predictions,
    summary,
    lowStock,
    checkLowStock,
    restock
  };
}
