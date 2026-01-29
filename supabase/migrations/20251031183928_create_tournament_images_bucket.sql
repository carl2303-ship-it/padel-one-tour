/*
  # Create Tournament Images Storage Bucket

  1. Storage Setup
    - Create a public bucket named 'tournament-images'
    - Enable public access for reading images
    - Set up storage policies for image upload and access

  2. Security
    - Allow public read access to all images
    - Allow authenticated users to upload images
    - Allow authenticated users to update/delete their own tournament images
*/

-- Create the tournament-images bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('tournament-images', 'tournament-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to tournament images
CREATE POLICY "Public read access for tournament images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'tournament-images');

-- Allow authenticated users to upload tournament images
CREATE POLICY "Authenticated users can upload tournament images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tournament-images');

-- Allow authenticated users to update tournament images
CREATE POLICY "Authenticated users can update tournament images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'tournament-images');

-- Allow authenticated users to delete tournament images
CREATE POLICY "Authenticated users can delete tournament images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'tournament-images');