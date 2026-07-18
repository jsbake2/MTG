-- Per-card frame-compositor theme (which real-set-inspired card face to draw).
ALTER TABLE custom_cards ADD COLUMN IF NOT EXISTS frame_theme text NOT NULL DEFAULT 'classic';
