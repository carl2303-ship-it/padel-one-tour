-- Cores de marca personalizadas por organizador (self-service nas Definições)
ALTER TABLE user_logo_settings
  ADD COLUMN IF NOT EXISTS primary_color text,
  ADD COLUMN IF NOT EXISTS accent_color text;
