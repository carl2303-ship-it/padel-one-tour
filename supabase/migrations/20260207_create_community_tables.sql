-- ============================================
-- COMMUNITY TABLES for Padel One
-- ============================================

-- follows
CREATE TABLE IF NOT EXISTS follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(follower_id, following_id),
  CHECK(follower_id != following_id)
);
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read follows" ON follows;
CREATE POLICY "Anyone can read follows" ON follows FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can follow" ON follows;
CREATE POLICY "Users can follow" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
DROP POLICY IF EXISTS "Users can unfollow" ON follows;
CREATE POLICY "Users can unfollow" ON follows FOR DELETE USING (auth.uid() = follower_id);

-- community_posts
CREATE TABLE IF NOT EXISTS community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text,
  image_url text,
  video_url text,
  post_type text DEFAULT 'text',
  match_id uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read posts" ON community_posts;
CREATE POLICY "Anyone can read posts" ON community_posts FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can create posts" ON community_posts;
CREATE POLICY "Users can create posts" ON community_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own posts" ON community_posts;
CREATE POLICY "Users can delete own posts" ON community_posts FOR DELETE USING (auth.uid() = user_id);

-- community_groups
CREATE TABLE IF NOT EXISTS community_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  image_url text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE community_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read groups" ON community_groups;
CREATE POLICY "Anyone can read groups" ON community_groups FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can create groups" ON community_groups;
CREATE POLICY "Users can create groups" ON community_groups FOR INSERT WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "Creators can update groups" ON community_groups;
CREATE POLICY "Creators can update groups" ON community_groups FOR UPDATE USING (auth.uid() = created_by);
DROP POLICY IF EXISTS "Creators can delete groups" ON community_groups;
CREATE POLICY "Creators can delete groups" ON community_groups FOR DELETE USING (auth.uid() = created_by);

-- community_group_members
CREATE TABLE IF NOT EXISTS community_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);
ALTER TABLE community_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read members" ON community_group_members;
CREATE POLICY "Anyone can read members" ON community_group_members FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can join groups" ON community_group_members;
CREATE POLICY "Users can join groups" ON community_group_members FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Members can leave" ON community_group_members;
CREATE POLICY "Members can leave" ON community_group_members FOR DELETE USING (auth.uid() = user_id);

-- Storage bucket for community images
INSERT INTO storage.buckets (id, name, public) VALUES ('community', 'community', true) ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$
BEGIN
  -- Public read
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read community' AND tablename = 'objects') THEN
    CREATE POLICY "Public read community" ON storage.objects FOR SELECT USING (bucket_id = 'community');
  END IF;
  -- Auth upload
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth upload community' AND tablename = 'objects') THEN
    CREATE POLICY "Auth upload community" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'community' AND auth.role() = 'authenticated');
  END IF;
  -- Auth delete
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth delete community' AND tablename = 'objects') THEN
    CREATE POLICY "Auth delete community" ON storage.objects FOR DELETE USING (bucket_id = 'community' AND auth.role() = 'authenticated');
  END IF;
END $$;
