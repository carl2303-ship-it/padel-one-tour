import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc2NzkzNywiZXhwIjoyMDc1MzQzOTM3fQ.X0WTGfKO2UxhPRjkHSj7bYYLyQwMKQHBCY5oQJHLRVQ';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function resetOrganizerPassword() {
  const email = 'carl2303@gmail.com';
  const newPassword = 'Temp123!';

  console.log(`Resetting password for ${email}...`);

  const { data, error } = await supabase.auth.admin.updateUserById(
    '2f3df003-1ab6-4a14-b756-08800d95419a',
    { password: newPassword }
  );

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('✓ Password reset successfully!');
    console.log(`New password: ${newPassword}`);
  }
}

resetOrganizerPassword();
