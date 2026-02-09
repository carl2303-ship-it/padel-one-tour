/*
  # Create Player Avatars Storage Bucket

  1. Create a public bucket for player avatar images
  2. Set up policies for upload, read and delete
*/

-- Create bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('player-avatars', 'player-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read access for player avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'player-avatars');

-- Allow authenticated users to upload their own avatar
CREATE POLICY "Authenticated users can upload avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'player-avatars');

-- Allow authenticated users to update their own avatar
CREATE POLICY "Authenticated users can update avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'player-avatars');

-- Allow authenticated users to delete their own avatar
CREATE POLICY "Authenticated users can delete avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'player-avatars');
