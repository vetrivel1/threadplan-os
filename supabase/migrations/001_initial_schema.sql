-- ThreadPlan OS — Multi-tenant production scheduling schema
-- Run in Supabase SQL editor or via supabase db push

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations (tenants)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Profiles linked to auth.users
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'planner' CHECK (role IN ('admin', 'planner', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE production_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('knitting', 'cutting', 'sewing', 'packing')),
  operators INTEGER NOT NULL DEFAULT 20,
  shift_minutes INTEGER NOT NULL DEFAULT 480,
  efficiency_baseline NUMERIC(4,2) NOT NULL DEFAULT 0.90,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE styles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  complexity NUMERIC(3,1) NOT NULL DEFAULT 1.0,
  smv_knitting NUMERIC(6,2) NOT NULL,
  smv_cutting NUMERIC(6,2) NOT NULL,
  smv_sewing NUMERIC(6,2) NOT NULL,
  smv_packing NUMERIC(6,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE TABLE learning_curves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  style_id UUID NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  efficiency NUMERIC(4,2) NOT NULL,
  UNIQUE (style_id, day_number)
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  style_id UUID NOT NULL REFERENCES styles(id),
  quantity INTEGER NOT NULL,
  packing_type TEXT NOT NULL DEFAULT 'solid' CHECK (packing_type IN ('solid', 'assorted')),
  rm_in_house_date DATE NOT NULL,
  delivery_deadline DATE NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, order_number)
);

CREATE TABLE schedule_cells (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_id UUID NOT NULL REFERENCES production_lines(id),
  stage TEXT NOT NULL CHECK (stage IN ('knitting', 'cutting', 'sewing', 'packing')),
  schedule_date DATE NOT NULL,
  planned_qty INTEGER NOT NULL DEFAULT 0,
  actual_qty INTEGER,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  efficiency NUMERIC(4,2),
  capacity_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, stage, schedule_date, line_id)
);

CREATE TABLE ai_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  days_late INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_curves ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own org" ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users see own profile" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Org scoped lines" ON production_lines
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Org scoped styles" ON styles
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Org scoped curves" ON learning_curves
  FOR ALL USING (
    style_id IN (
      SELECT id FROM styles WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Org scoped orders" ON orders
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Org scoped cells" ON schedule_cells
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Org scoped ai" ON ai_recommendations
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE INDEX idx_schedule_cells_date ON schedule_cells(schedule_date);
CREATE INDEX idx_schedule_cells_order ON schedule_cells(order_id);
CREATE INDEX idx_orders_deadline ON orders(delivery_deadline);
