/*
  # Add Phone Number to Players

  1. Changes
    - Add phone_number field to players table (required for SMS notifications)
    - Add notification_sent field to matches to track if notification was sent

  2. Security
    - Phone numbers are private and follow same RLS as player data
*/

-- Add phone number to players table
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS phone_number text;

-- Add notification tracking to matches
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS notification_sent boolean DEFAULT false;

-- Create index for efficient notification queries
CREATE INDEX IF NOT EXISTS idx_matches_scheduled_time_notification 
ON matches(scheduled_time, notification_sent) 
WHERE scheduled_time IS NOT NULL;
