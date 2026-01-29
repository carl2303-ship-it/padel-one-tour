/*
  # Fix Infinite Recursion in Tournaments RLS Policies

  1. Problem
    - The policy "Players can view tournaments they are enrolled in" queries players/teams tables
    - Players/teams tables have policies that query tournaments table
    - This creates infinite recursion when evaluating RLS

  2. Solution
    - Drop the problematic policy that causes recursion
    - Keep simpler policies that don't create circular references
    - Organizers can view their own tournaments via "Users can view own tournaments"
    - Anonymous users can view public tournaments via existing policies
*/

DROP POLICY IF EXISTS "Players can view tournaments they are enrolled in" ON tournaments;
