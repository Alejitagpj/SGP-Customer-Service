import { createClient } from '@supabase/supabase-js';
import * as mockDb from '../services/mockData';
import type { Order, OrderStatus, TableSession } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Force mock mode if credentials are empty or VITE_USE_MOCK is explicitly true
export const isMockMode = !supabaseUrl || !supabaseAnonKey || import.meta.env.VITE_USE_MOCK === 'true';

console.log(`[SGP API] Running in ${isMockMode ? 'MOCK' : 'SUPABASE'} Mode`);

// Real Supabase client instance (instantiated only if credentials exist)
export const supabase = !isMockMode ? createClient(supabaseUrl, supabaseAnonKey) : null;

// ============================================================================
// TRANSITORY SERVICE API WRAPPER
// ============================================================================

export const sgpApi = {
  // 1. MENU SERVICES
  async getCategories() {
    if (isMockMode) {
      return { data: mockDb.mockCategories, error: null };
    }
    const { data, error } = await supabase!
      .from('categories')
      .select('*')
      .order('order_index', { ascending: true });
    return { data, error };
  },

  async getProducts() {
    if (isMockMode) {
      return { data: mockDb.mockProducts, error: null };
    }
    const { data, error } = await supabase!
      .from('products')
      .select('*')
      .eq('is_available', true);
    return { data, error };
  },

  // 2. TABLE & SESSION SERVICES
  async getTables() {
    if (isMockMode) {
      return { data: mockDb.mockTables, error: null };
    }
    const { data, error } = await supabase!
      .from('tables')
      .select('*')
      .eq('active', true);
    return { data, error };
  },

  async getStores() {
    if (isMockMode) {
      return { data: mockDb.mockStores, error: null };
    }
    const { data, error } = await supabase!
      .from('stores')
      .select('*');
    return { data, error };
  },

  async getStoreOrders(storeId: string): Promise<{ data: Order[] | null; error: any }> {
    if (isMockMode) {
      mockDb.runCleanupCycle();
      const orders = mockDb.getStoredOrders().filter(o => o.store_id === storeId);
      const sessions = mockDb.getStoredSessions();
      const hydrated = orders.map(o => {
        const session = sessions.find(s => s.id === o.table_session_id);
        const table = mockDb.mockTables.find(t => t.id === session?.table_id);
        return {
          ...o,
          table_name: table ? table.name : 'Mesa'
        };
      });
      return { data: hydrated, error: null };
    }

    const { data, error } = await supabase!
      .from('orders')
      .select(`*, table_session:table_sessions(id, table:tables(name)), items:order_items(*)`)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    const hydrated = data?.map((order: any) => ({
      ...order,
      table_name: order.table_session?.table?.name || 'Mesa',
      items: order.items
    })) as Order[];
    return { data: hydrated || null, error };
  },

  async validateTablePasscode(tableId: string, passcode: string): Promise<boolean> {
    if (isMockMode) {
      return mockDb.validateTablePasscode(tableId, passcode);
    }
    const { data, error } = await supabase!
      .from('tables')
      .select('passcode')
      .eq('id', tableId)
      .single();
    if (error || !data) return false;
    return data.passcode === passcode;
  },

  async getOrCreateActiveSession(tableId: string): Promise<{ data: TableSession | null; error: any }> {
    if (isMockMode) {
      try {
        const session = mockDb.findOrCreateActiveSession(tableId);
        return { data: session, error: null };
      } catch (err: any) {
        return { data: null, error: err.message };
      }
    }

    // 1. Look for active session
    const { data: existing, error: searchError } = await supabase!
      .from('table_sessions')
      .select('*')
      .eq('table_id', tableId)
      .eq('status', 'active')
      .maybeSingle();

    if (searchError) return { data: null, error: searchError };
    if (existing) return { data: existing, error: null };

    // 2. If none, retrieve table info for store_id
    const { data: table, error: tableError } = await supabase!
      .from('tables')
      .select('store_id')
      .eq('id', tableId)
      .single();

    if (tableError) return { data: null, error: tableError };

    // 3. Create new session
    const { data: session, error: createError } = await supabase!
      .from('table_sessions')
      .insert({
        table_id: tableId,
        store_id: table!.store_id,
        status: 'active'
      })
      .select()
      .single();

    return { data: session, error: createError };
  },

  async getSessionStatus(sessionId: string): Promise<{ data: TableSession | null; error: any }> {
    if (isMockMode) {
      mockDb.runCleanupCycle();
      const sessions = mockDb.getStoredSessions();
      const session = sessions.find(s => s.id === sessionId);
      return { data: session || null, error: session ? null : 'Session not found' };
    }
    const { data, error } = await supabase!
      .from('table_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    return { data, error };
  },

  // 3. ORDER SERVICES
  async placeOrder(
    storeId: string,
    tableSessionId: string,
    items: { productId: string; quantity: number; notes: string }[],
    notes: string
  ): Promise<{ data: Order | null; error: any }> {
    if (isMockMode) {
      try {
        const order = mockDb.placeMockOrder(storeId, tableSessionId, items, notes);
        return { data: order, error: null };
      } catch (err: any) {
        return { data: null, error: err.message };
      }
    }

    // Enforce active orders limit of 2 in DB
    const { count, error: countErr } = await supabase!
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('table_session_id', tableSessionId)
      .not('status', 'eq', 'cancelled');

    if (countErr) return { data: null, error: countErr };
    if (count && count >= 2) {
      return { data: null, error: 'Límite excedido: Solo se permiten un máximo de 2 órdenes por mesa simultáneamente.' };
    }

    // Calculate total price from DB
    const productIds = items.map(i => i.productId);
    const { data: products, error: prodErr } = await supabase!
      .from('products')
      .select('id, price')
      .in('id', productIds);

    if (prodErr) return { data: null, error: prodErr };

    let totalAmount = 0;
    const priceMap = new Map(products.map(p => [p.id, p.price]));
    items.forEach(item => {
      const price = priceMap.get(item.productId) || 0;
      totalAmount += price * item.quantity;
    });

    // 1. Create order record
    const { data: order, error: orderErr } = await supabase!
      .from('orders')
      .insert({
        store_id: storeId,
        table_session_id: tableSessionId,
        status: 'pending',
        total_amount: parseFloat(totalAmount.toFixed(2)),
        notes: notes || null
      })
      .select()
      .single();

    if (orderErr) return { data: null, error: orderErr };

    // 2. Create order items
    const orderItemsToInsert = items.map(item => ({
      order_id: order.id,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: priceMap.get(item.productId) || 0,
      notes: item.notes || null
    }));

    const { error: itemsErr } = await supabase!
      .from('order_items')
      .insert(orderItemsToInsert);

    if (itemsErr) return { data: null, error: itemsErr };

    // Trigger Realtime Broadcast Channel event
    await this.broadcastEvent('order_created', order);

    return { data: order, error: null };
  },

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<{ data: Order | null; error: any }> {
    if (isMockMode) {
      try {
        const order = mockDb.updateMockOrderStatus(orderId, status);
        return { data: order, error: null };
      } catch (err: any) {
        return { data: null, error: err.message };
      }
    }

    const updateData: any = { status };
    
    // Add timestamps when marking as ready or delivered
    if (status === 'ready') {
      updateData.ready_at = new Date().toISOString();
    } else if (status === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
    }

    const { data, error } = await supabase!
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (!error && data) {
      await this.broadcastEvent('status_changed', data);
      
      // If delivered, record wait time for scoring
      if (status === 'delivered' && data.created_at && data.delivered_at) {
        const waitTimeMs = new Date(data.delivered_at).getTime() - new Date(data.created_at).getTime();
        await this.recordWaitTime(orderId, waitTimeMs);
      }
    }
    return { data, error };
  },

  async recordWaitTime(orderId: string, waitTimeMs: number): Promise<void> {
    if (isMockMode) return;

    // Get products from this order
    const { data: items, error: itemsErr } = await supabase!
      .from('order_items')
      .select('product_id')
      .eq('order_id', orderId);

    if (itemsErr || !items) return;

    // Get order store_id
    const { data: order, error: orderErr } = await supabase!
      .from('orders')
      .select('store_id')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) return;

    // Update product_scores for each item
    for (const item of items) {
      const { data: score } = await supabase!
        .from('product_scores')
        .select('*')
        .eq('product_id', item.product_id)
        .eq('store_id', order.store_id)
        .single();

      if (score) {
        const newTotalTime = score.total_wait_time_ms + waitTimeMs;
        const newCount = score.total_prepared + 1;
        const newAvg = Math.round(newTotalTime / newCount);

        await supabase!
          .from('product_scores')
          .update({
            total_prepared: newCount,
            total_wait_time_ms: newTotalTime,
            avg_wait_time_ms: newAvg,
            last_updated: new Date().toISOString()
          })
          .eq('id', score.id);
      } else {
        // Create new score record
        await supabase!
          .from('product_scores')
          .insert({
            product_id: item.product_id,
            store_id: order.store_id,
            total_prepared: 1,
            total_wait_time_ms: waitTimeMs,
            avg_wait_time_ms: waitTimeMs
          });
      }
    }
  },

  async generateQRCodes(storeId: string, baseUrl: string): Promise<{ data: any[] | null; error: any }> {
    if (isMockMode) {
      return { data: [], error: null };
    }

    // Get all tables for store
    const { data: tables, error: tablesErr } = await supabase!
      .from('tables')
      .select('*')
      .eq('store_id', storeId)
      .eq('active', true);

    if (tablesErr) return { data: null, error: tablesErr };
    if (!tables) return { data: [], error: null };

    // Generate QR code URLs
    const qrCodes = tables.map(table => ({
      table_id: table.id,
      store_id: storeId,
      passcode: table.passcode,
      qr_url: `${baseUrl}?table=${table.id}&code=${table.passcode}`
    }));

    // Upsert into qr_codes table (replace existing)
    const { error } = await supabase!
      .from('qr_codes')
      .upsert(qrCodes, { onConflict: 'table_id' });

    return { data: qrCodes, error };
  },

  async getQRCodes(storeId: string): Promise<{ data: any[] | null; error: any }> {
    if (isMockMode) {
      return { data: [], error: null };
    }

    const { data, error } = await supabase!
      .from('qr_codes')
      .select('*')
      .eq('store_id', storeId);

    return { data, error };
  }

  async payAndCloseSession(sessionId: string): Promise<{ data: TableSession | null; error: any }> {
    if (isMockMode) {
      try {
        const session = mockDb.payAndCloseSession(sessionId);
        return { data: session, error: null };
      } catch (err: any) {
        return { data: null, error: err.message };
      }
    }

    const { data, error } = await supabase!
      .from('table_sessions')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (!error && data) {
      await this.broadcastEvent('session_closed', { sessionId, paid_at: data.paid_at });
    }
    return { data, error };
  },

  async getSessionOrders(sessionId: string): Promise<{ data: Order[] | null; error: any }> {
    if (isMockMode) {
      const orders = mockDb.getStoredOrders().filter(o => o.table_session_id === sessionId);
      return { data: orders, error: null };
    }

    const { data, error } = await supabase!
      .from('orders')
      .select(`
        *,
        items:order_items(
          *,
          product:products(name)
        )
      `)
      .eq('table_session_id', sessionId);
    
    // Hydrate names for compatibility
    const hydrated = data?.map(o => ({
      ...o,
      items: o.items?.map((item: any) => ({
        ...item,
        product_name: item.product?.name
      }))
    })) as Order[];

    return { data: hydrated || null, error };
  },

  async getActiveStoreOrders(storeId: string): Promise<{ data: Order[] | null; error: any }> {
    if (isMockMode) {
      mockDb.runCleanupCycle();
      const sessions = mockDb.getStoredSessions().filter(s => s.status === 'active');
      const sessionIds = new Set(sessions.map(s => s.id));
      const orders = mockDb.getStoredOrders().filter(
        o => o.store_id === storeId && sessionIds.has(o.table_session_id) && o.status !== 'cancelled'
      );
      
      // Hydrate table names
      const hydrated = orders.map(o => {
        const session = sessions.find(s => s.id === o.table_session_id);
        const table = mockDb.mockTables.find(t => t.id === session?.table_id);
        return {
          ...o,
          table_name: table ? table.name : 'Mesa'
        };
      });

      return { data: hydrated, error: null };
    }

    // Get active table sessions
    const { data: activeSessions, error: sErr } = await supabase!
      .from('table_sessions')
      .select('id, table:tables(name)')
      .eq('store_id', storeId)
      .eq('status', 'active');

    if (sErr) return { data: null, error: sErr };
    if (!activeSessions || activeSessions.length === 0) return { data: [], error: null };

    const sessionIds = activeSessions.map(s => s.id);
    const sessionMap = new Map(activeSessions.map(s => [s.id, (s.table as any)?.name]));

    const { data: orders, error } = await supabase!
      .from('orders')
      .select(`
        *,
        items:order_items(
          *,
          product:products(name)
        )
      `)
      .in('table_session_id', sessionIds)
      .not('status', 'eq', 'cancelled');

    const hydrated = orders?.map(o => ({
      ...o,
      table_name: sessionMap.get(o.table_session_id) || 'Mesa',
      items: o.items?.map((item: any) => ({
        ...item,
        product_name: item.product?.name
      }))
    })) as Order[];

    return { data: hydrated || null, error };
  },

  // 4. REAL-TIME BROADCAST SYSTEM
  async broadcastEvent(event: string, payload: any) {
    if (isMockMode) {
      mockDb.triggerLocalBroadcast(event, payload);
      return;
    }

    // Connect to Supabase Broadcast channel
    const channel = supabase!.channel('sgp_realtime_broadcast');
    await channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.send({
          type: 'broadcast',
          event,
          payload
        });
        // Ephemeral channel clean
        supabase!.removeChannel(channel);
      }
    });
  },

  subscribeToBroadcast(callback: (event: string, payload: any) => void) {
    if (isMockMode) {
      return mockDb.subscribeToLocalBroadcast(callback);
    }

    // Connect standard channel subscription
    const channel = supabase!.channel('sgp_realtime_broadcast', {
      config: { broadcast: { self: true } }
    });

    channel
      .on('broadcast', { event: '*' }, (message: any) => {
        callback(message.event, message.payload);
      })
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }
};
export default sgpApi;
