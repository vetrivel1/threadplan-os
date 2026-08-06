-- Support multiple lines per order/stage/date (dual sewing lines)
ALTER TABLE schedule_cells
  DROP CONSTRAINT IF EXISTS schedule_cells_order_id_stage_schedule_date_key;

ALTER TABLE schedule_cells
  ADD CONSTRAINT schedule_cells_order_stage_date_line_key
  UNIQUE (order_id, stage, schedule_date, line_id);
