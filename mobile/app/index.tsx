// Root index — redirect to auth or tabs based on login state
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { getUserId } from '@/services/api';

export default function Index() {
  const [checked, setChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    getUserId().then(id => {
      setLoggedIn(!!id);
      setChecked(true);
    });
  }, []);

  if (!checked) return null; // splash still showing

  return <Redirect href={loggedIn ? '/(tabs)' : '/(auth)'} />;
}
