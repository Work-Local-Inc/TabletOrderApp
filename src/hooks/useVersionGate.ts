import { useCallback, useEffect, useRef, useState } from 'react';
import * as Application from 'expo-application';

type VersionGateResponse = {
  min_version: string;
  latest_version?: string;
  required?: boolean;
  message?: string;
  update_url?: string;
};

type VersionGateState = {
  isChecking: boolean;
  forceUpdate: boolean;
  message: string;
  updateUrl: string;
  currentVersion: string;
  minVersion: string;
  latestVersion: string;
  lastCheckedAt: string | null;
};

const DEFAULT_UPDATE_URL = (packageId: string) =>
  `market://details?id=${packageId}`;

const FALLBACK_PLAY_URL = (packageId: string) =>
  `https://play.google.com/store/apps/details?id=${packageId}`;

const VERSION_CHECK_URL =
  process.env.EXPO_PUBLIC_VERSION_CHECK_URL || 'https://orders.menu.ca/api/tablet/version';

const normalizeVersion = (version: string): number[] => {
  return (version || '0.0.0')
    .split('.')
    .map((part) => parseInt(part, 10))
    .map((num) => (Number.isNaN(num) ? 0 : num));
};

const compareVersions = (a: string, b: string): number => {
  const aParts = normalizeVersion(a);
  const bParts = normalizeVersion(b);
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i += 1) {
    const av = aParts[i] || 0;
    const bv = bParts[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
};

export const useVersionGate = () => {
  const packageId = Application.applicationId || 'ca.menu.orders';
  const currentVersion = Application.nativeApplicationVersion || '0.0.0';
  const [state, setState] = useState<VersionGateState>({
    isChecking: false,
    forceUpdate: false,
    message: '',
    updateUrl: DEFAULT_UPDATE_URL(packageId),
    currentVersion,
    minVersion: '',
    latestVersion: '',
    lastCheckedAt: null,
  });

  const checkInFlight = useRef(false);

  const checkNow = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;

    setState((prev) => ({ ...prev, isChecking: true }));

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(VERSION_CHECK_URL, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Version check failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as VersionGateResponse;
      const minVersion = data.min_version || '';
      const latestVersion = data.latest_version || '';
      const required = data.required ?? true;

      const outdated =
        minVersion && compareVersions(currentVersion, minVersion) < 0;

      const updateUrl =
        data.update_url ||
        DEFAULT_UPDATE_URL(packageId) ||
        FALLBACK_PLAY_URL(packageId);

      setState((prev) => ({
        ...prev,
        isChecking: false,
        forceUpdate: Boolean(required && outdated),
        message:
          data.message ||
          'An update is required to continue receiving orders.',
        updateUrl,
        minVersion,
        latestVersion,
        lastCheckedAt: new Date().toISOString(),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isChecking: false,
        lastCheckedAt: new Date().toISOString(),
      }));
    } finally {
      checkInFlight.current = false;
    }
  }, [currentVersion, packageId]);

  useEffect(() => {
    checkNow();
  }, [checkNow]);

  return { ...state, checkNow };
};
