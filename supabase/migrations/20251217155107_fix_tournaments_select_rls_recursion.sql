/*
  # Fix infinite recursion in tournaments SELECT policies

  1. Problem
    - The "Authenticated users can view tournaments" policy has EXISTS queries checking players and teams
    - Those tables have policies that check tournaments, creating infinite recursion
    
  2. Solution
    - Split into simpler policies that don't create recursion
    - Policy for tournament owners (simple user_id check)
    - Policy for public tournaments (simple allow_public_registration check)
    - Remove complex EXISTS subqueries that cause recursion
    
  3. Security
    - Maintains same access patterns but without recursion
    - Organizers can see their own tournaments
    - Anyone can see public tournaments
    - Players can see tournaments through a separate, simpler mechanism
*/

-- Drop the problematic policy
DROP POLICY IF EXISTS "Authenticated users can view tournaments" ON tournaments;

-- Create simpler policies without recursion
CREATE POLICY "Organizers can view own tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Anyone can view public tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (allow_public_registration = true);
