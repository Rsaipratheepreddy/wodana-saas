import { Redirect } from 'expo-router';

// The + tab opens the capture sheet instead of a page; landing here (a link) goes to Today.
export default function Capture() {
  return <Redirect href="/" />;
}
