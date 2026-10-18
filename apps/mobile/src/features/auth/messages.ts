import { key } from '../../core/i18n';

/**
 * What sign-in and session problems say (the auth client's English text is the key), so every one of
 * them is translated when shown through t().
 */
export const AUTH_MESSAGES = [
  key('Authentication is not configured for this build.'), key('Authentication is unavailable. Please try again.'), key('Check your details and try again.'),
  key('Email or password is incorrect.'), key('Enter a valid workspace code.'), key('Sign-in was cancelled.'), key('The authentication service returned an invalid session.'),
  key('The organization could not be verified. Try again.'), key('The verification request was incomplete. Sign in again.'),
  key('The verification response did not match this workspace.'), key('This app is configured for a different workspace.'), key('Too many attempts. Please try again later.'),
  key('Unable to connect. Check your connection and try again.'), key('Unable to save your sign-in securely. Please try again.'), key('Unable to verify your account. Please try again.'),
  key('Unable to verify your workspace.'), key('Verification code is incorrect.'), key('Workspace access could not be verified. Sign in again later.'),
  key('You no longer have access to this workspace.'), key('Your session has expired. Sign in again.'), key('Sign-in is unavailable. Please try again.'),
  key('You are signed in on too many devices.'), key('Unable to read your saved sign-in. Try again.'),
  key('Sign-in was closed, but saved-session cleanup failed. Please try again.'),
  // Validation of the sign-in form.
  key('Enter your work email.'), key('Enter a valid email address.'), key('Enter your password.'), key('Password must be 128 characters or fewer.'),
];
