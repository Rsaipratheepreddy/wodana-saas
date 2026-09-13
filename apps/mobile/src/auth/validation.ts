export function validateCredentials(email: string, password: string) {
  return {
    email: !email.trim() ? 'Enter your work email.'
      : email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? 'Enter a valid email address.' : '',
    // Sign-in accepts existing credentials; password creation policy belongs to invitation/reset.
    password: !password ? 'Enter your password.' : password.length > 128 ? 'Password must be 128 characters or fewer.' : '',
  };
}
