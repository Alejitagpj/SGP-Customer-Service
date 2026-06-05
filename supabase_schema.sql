-- ============================================================================
-- SGP (Sistemas de Gestión de Pedidos) - MVP Schema
-- Designed for Multi-tenant (SaaS) scalability and mobile-first operations.
-- ============================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. STORES (Restaurants / Merchants)
CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    pin_code VARCHAR(10) NOT NULL DEFAULT '1234', -- Master login PIN for staff
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX idx_stores_slug ON stores(slug);

-- 2. TABLES (Physical tables in each store)
CREATE TABLE tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL, -- e.g., "Mesa 1", "Mesa 2"
    passcode VARCHAR(10) NOT NULL, -- Access passcode for scanning customers (e.g. 1001)
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX idx_tables_store_id ON tables(store_id);

-- 3. TABLE SESSIONS (Active sessions for diners at a table)
CREATE TABLE table_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' or 'paid'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE, -- Marks the 15-minute disappearance window start
    CONSTRAINT chk_session_status CHECK (status IN ('active', 'paid'))
);

CREATE INDEX idx_table_sessions_table_store ON table_sessions(table_id, store_id);
CREATE INDEX idx_table_sessions_status ON table_sessions(status);

-- 4. CATEGORIES (Menu categories)
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- e.g. "Entradas", "Bebidas con Alcohol"
    order_index INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX idx_categories_store_id ON categories(store_id);

-- 5. PRODUCTS (Menu options)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    image_url TEXT,
    ingredients TEXT[] DEFAULT '{}'::TEXT[],
    is_available BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX idx_products_category_id ON products(category_id);

-- 6. ORDERS (Orders placed in an active session)
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    table_session_id UUID NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'preparing', 'ready', 'delivered', 'cancelled'
    total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    ready_at TIMESTAMP WITH TIME ZONE, -- When cook marks as ready
    delivered_at TIMESTAMP WITH TIME ZONE, -- When waiter marks as delivered
    CONSTRAINT chk_order_status CHECK (status IN ('pending', 'preparing', 'ready', 'delivered', 'cancelled'))
);

CREATE INDEX idx_orders_session ON orders(table_session_id);
CREATE INDEX idx_orders_store_status ON orders(store_id, status);

-- 7. ORDER ITEMS (Line items per order)
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================================================
-- REAL-TIME BROADCAST DOCUMENTATION & NOTES
-- ============================================================================
-- Supabase Realtime Broadcast allows client-to-client ephemeral communication.
-- This bypasses standard database triggers for UI syncing, providing sub-100ms latency.
--
-- To set up Broadcast Channels on Supabase Dashboard:
-- 1. Broadcast doesn't require database changes enabled in the "realtime" schema.
-- 2. It is activated via the JS client:
--    const channel = supabase.channel('table-orders-channel', {
--      config: {
--        broadcast: { self: false, ack: false }
--      }
--    });
--
-- 3. Clients subscribe to custom events:
--    channel.on('broadcast', { event: 'new_order' }, (payload) => {
--       console.log('New order received:', payload);
--    });
--
-- 4. Clients send updates:
--    channel.send({
--      type: 'broadcast',
--      event: 'new_order',
--      payload: { orderId: 'uuid', table: 'Mesa 3', items: [...] }
--    });
--
-- This guarantees maximum throughput, low DB CPU utilization, y robust security.
-- Row Level Security (RLS) can still proteger database reads/writes of actual tables.
-- ============================================================================

-- ============================================================================
-- SAMPLE SEED DATA
-- ============================================================================

-- Stores and branches
INSERT INTO stores (id, name, slug, logo_url, pin_code)
VALUES
('00000000-0000-0000-0000-000000000001', 'El Rincón del Sabor - Centro', 'el-rincon-sabor-centro', 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=150&q=80', '2580'),
('00000000-0000-0000-0000-000000000002', 'El Rincón del Sabor - Plaza Norte', 'el-rincon-sabor-plaza', 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=150&q=80', '2590'),
('00000000-0000-0000-0000-000000000003', 'Casa Delicias - Miraflores', 'casa-delicias-miraflores', 'https://images.unsplash.com/photo-1498654896293-37aacf113fd9?auto=format&fit=crop&w=150&q=80', '2600');

-- Tables
INSERT INTO tables (id, store_id, name, passcode)
VALUES
('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', 'Mesa 1', '1001'),
('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000001', 'Mesa 2', '1002'),
('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000001', 'Mesa 3', '1003'),
('00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-000000000001', 'Mesa 4', '1004'),
('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000002', 'Mesa 1', '1011'),
('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000000002', 'Mesa 2', '1012'),
('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000000002', 'Mesa 3', '1013'),
('00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000000003', 'Mesa 1', '1021'),
('00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000003', 'Mesa 2', '1022');

-- Categories
INSERT INTO categories (id, store_id, name, order_index)
VALUES
('00000000-0000-0000-0000-000000010001', '00000000-0000-0000-0000-000000000001', 'Entradas', 1),
('00000000-0000-0000-0000-000000010002', '00000000-0000-0000-0000-000000000001', 'Platos Fuertes', 2),
('00000000-0000-0000-0000-000000010003', '00000000-0000-0000-0000-000000000002', 'Entradas', 1),
('00000000-0000-0000-0000-000000010004', '00000000-0000-0000-0000-000000000002', 'Platos Fuertes', 2),
('00000000-0000-0000-0000-000000010005', '00000000-0000-0000-0000-000000000003', 'Bebidas', 1);

-- Products
INSERT INTO products (id, category_id, name, description, price, image_url, ingredients, is_available)
VALUES
('00000000-0000-0000-0000-000000020001', '00000000-0000-0000-0000-000000010001', 'Tequeños Crujientes', 'Deditos de queso envueltos en masa crujiente.', 8.5, NULL, ARRAY['Queso blanco','Harina de trigo','Huevo'], TRUE),
('00000000-0000-0000-0000-000000020002', '00000000-0000-0000-0000-000000010001', 'Ceviche de Camarón', 'Marinado en limón, ají y cilantro.', 14.0, NULL, ARRAY['Camarón','Limón','Cebolla'], TRUE),
('00000000-0000-0000-0000-000000020003', '00000000-0000-0000-0000-000000010002', 'Lomo Saltado', 'Lomo de res salteado con cebolla y tomate.', 19.5, NULL, ARRAY['Lomo','Cebolla','Tomate','Sillao'], TRUE),
('00000000-0000-0000-0000-000000020004', '00000000-0000-0000-0000-000000010002', 'Salmón Grillado', 'Salmón con salsa de eneldo y espárragos.', 22.0, NULL, ARRAY['Salmón','Eneldo','Espárragos'], TRUE),
('00000000-0000-0000-0000-000000020005', '00000000-0000-0000-0000-000000010005', 'Limonada de Coco', 'Limonada cremosa con crema de coco.', 5.5, NULL, ARRAY['Limón','Coco','Hielo'], TRUE);

-- Optional test data
INSERT INTO table_sessions (id, table_id, store_id, status)
VALUES
('00000000-0000-0000-0000-000000030001', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', 'active');

INSERT INTO orders (id, store_id, table_session_id, status, total_amount)
VALUES
('00000000-0000-0000-0000-000000040001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000030001', 'pending', 8.5);

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
VALUES
('00000000-0000-0000-0000-000000050001', '00000000-0000-0000-0000-000000040001', '00000000-0000-0000-0000-000000020001', 1, 8.5);

-- 8. PRODUCT WAIT TIME SCORING (for ML-based predictions)
CREATE TABLE IF NOT EXISTS product_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  total_prepared INTEGER DEFAULT 0, -- Total orders with this product
  total_wait_time_ms BIGINT DEFAULT 0, -- Sum of all wait times in ms
  avg_wait_time_ms INTEGER DEFAULT 0, -- Calculated average
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  UNIQUE(product_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_product_scores_store ON product_scores(store_id);

-- 9. QR CODES & PASSCODES TABLE (for tracking and regeneration)
CREATE TABLE IF NOT EXISTS qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  passcode VARCHAR(10) NOT NULL,
  qr_url TEXT NOT NULL, -- URL encoded in QR (e.g. https://sgp.example.com?table=UUID&code=XXXX)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  UNIQUE(table_id)
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_store ON qr_codes(store_id);

-- 8. DAILY SALES AGGREGATION (per day, per hour)
CREATE TABLE IF NOT EXISTS daily_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  sale_hour SMALLINT NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_sales_date_store ON daily_sales(sale_date, store_id);

-- 9. MONTHLY REPORTS
CREATE TABLE IF NOT EXISTS monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start DATE NOT NULL,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  report_json JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monthly_reports_month_store ON monthly_reports(month_start, store_id);

