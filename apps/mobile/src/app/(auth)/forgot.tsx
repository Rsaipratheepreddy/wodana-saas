import { useLocalSearchParams } from 'expo-router';
import { ForgotScreen } from '../../features/auth/screens';

export default function Forgot() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  return <ForgotScreen initialEmail={typeof email === 'string' ? email : ''} />;
}
