/*
  # Fix Tournament Images Bucket Policies

  1. Changes
    - Drop existing policies
    - Create new policies allowing public (anonymous) access for uploads
    - Allow public read, insert, update, and delete access

  2. Security
    - Allow public users to upload tournament images
    - Allow public read access to all images
    - Allow public update and delete access
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public read access for tournament images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload tournament images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update tournament images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete tournament images" ON storage.objects;

-- Allow public (anyone) to read tournament images
CREATE POLICY "Anyone can read tournament images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'tournament-images');

-- Allow public (anyone) to upload tournament images
CREATE POLICY "Anyone can upload tournament images"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'tournament-images');

-- Allow public (anyone) to update tournament images
CREATE POLICY "Anyone can update tournament images"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'tournament-images');

-- Allow public (anyone) to delete tournament images
CREATE POLICY "Anyone can delete tournament images"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'tournament-images');