import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3Njc5MzcsImV4cCI6MjA3NTM0MzkzN30.Dl05zPQDtPVpmvn_Y-JokT3wDq0Oh9uF3op5xcHZpkY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function resetPlayerPassword(phoneNumber) {
  // First, sign in as an admin user
  // You'll need to provide valid admin credentials
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'carl2303@gmail.com', // Replace with your admin email
    password: 'yourpassword', // Replace with your admin password
  });

  if (authError) {
    console.error('Auth error:', authError);
    return;
  }

  console.log('Authenticated as:', authData.user.email);

  // Call the edge function
  const { data, error } = await supabase.functions.invoke('reset-player-password', {
    body: { phone_number: phoneNumber },
  });

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Success:', data);
  }
}

// Reset password for the problematic phone numbers
const phoneNumbers = ['+351969365059', '+351969365060', '+351969365070'];

for (const phone of phoneNumbers) {
  console.log(`\nResetting password for ${phone}...`);
  await resetPlayerPassword(phone);
}
