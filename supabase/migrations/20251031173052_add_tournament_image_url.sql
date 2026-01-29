/*
  # Add image URL field to tournaments

  1. Changes
    - Add `image_url` column to `tournaments` table
      - Stores the URL of the tournament poster/banner image
      - Optional field (can be null)
      - Text type to store image URLs (from Pexels or user-provided)
  
  2. Notes
    - This allows tournaments to have a visual banner/poster
    - Images can be from stock photo services like Pexels or custom URLs
    - Will be displayed in tournament cards, detail pages, and registration landing
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN image_url text;
  END IF;
END $$;