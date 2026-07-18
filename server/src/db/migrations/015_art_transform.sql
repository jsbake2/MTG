-- Store how the art is positioned inside the card's art window so users can
-- pan/zoom to fit. custom_art.data now holds the ORIGINAL image; the compositor
-- applies this transform when drawing. Identity (1,0,0) = cover-fit centered.
ALTER TABLE custom_art ADD COLUMN IF NOT EXISTS tx_scale real NOT NULL DEFAULT 1;
ALTER TABLE custom_art ADD COLUMN IF NOT EXISTS tx_dx    real NOT NULL DEFAULT 0;
ALTER TABLE custom_art ADD COLUMN IF NOT EXISTS tx_dy    real NOT NULL DEFAULT 0;
