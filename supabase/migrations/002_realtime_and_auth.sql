-- Enable realtime for collaborative schedule editing
ALTER PUBLICATION supabase_realtime ADD TABLE schedule_cells;

-- Auto-update updated_at on schedule_cells
CREATE OR REPLACE FUNCTION update_schedule_cells_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER schedule_cells_updated_at
  BEFORE UPDATE ON schedule_cells
  FOR EACH ROW
  EXECUTE FUNCTION update_schedule_cells_timestamp();

-- Profile bootstrap on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_org_id UUID;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'aurora-textiles' LIMIT 1;

  IF default_org_id IS NOT NULL THEN
    INSERT INTO profiles (id, organization_id, full_name, role)
    VALUES (
      NEW.id,
      default_org_id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      'planner'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
