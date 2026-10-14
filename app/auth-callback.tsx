import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { Notice } from '@/components/auth/Notice';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { completeAuthRedirect } from '@/lib/auth/api';
import { parseAuthCallback } from '@/lib/auth/callback';

// The verify step already confirmed the email on the server; only the sign-in part
// needs the phone that asked for the link.
const CONFIRMED_ELSEWHERE = 'Your email is confirmed. Sign in to continue.';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams();
  const { client, session } = useAuth();
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeAuthRedirect(client, parseAuthCallback(params)).then(result => {
      if (result.ok) setDone(true);
      else setProblem(result.code === 'bad_code_verifier' ? CONFIRMED_ELSEWHERE : result.message);
    });
  }, [client, params]);

  if (done && session) {
    return <Redirect href="/" />;
  }

  if (!problem) {
    return (
      <AuthScreen>
        <ActivityIndicator accessibilityLabel="Signing you in" />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Notice tone={problem === CONFIRMED_ELSEWHERE ? 'info' : 'error'}>{problem}</Notice>
      <View style={authStyles.links}>
        {session ? (
          <Link href="/" replace style={authStyles.link}>
            Back to the planner
          </Link>
        ) : (
          <Link href="/sign-in" replace style={authStyles.link}>
            Back to sign in
          </Link>
        )}
      </View>
    </AuthScreen>
  );
}
