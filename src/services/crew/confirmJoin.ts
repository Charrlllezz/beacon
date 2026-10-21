import { Alert } from 'react-native';
import { parseInvite, crewIdFor } from './invite';
import { joinCrew } from './crewActions';
import { useCrewKeyStore } from '../../store/useCrewKeyStore';

const ERRORS = {
  'not-an-invite': ["That's not a crew invite", 'Scan the QR from Crew → Invite on a crew member\'s phone.'],
  'not-rndvu': ["That's not an RNDVU crew", "It's a Meshtastic channel with another name. Joining it would take your radio off the RNDVU frequency."],
  'bad-key': ["That invite doesn't work", "Its key isn't a valid crew key. Ask for a fresh invite."],
} as const;

/**
 * Scanned or opened an invite: check it, ask, then join (one radio restart).
 * Resolves true if the user joined.
 */
export function confirmJoin(text: string): Promise<boolean> {
  return new Promise(resolve => {
    const parsed = parseInvite(text);
    if (!parsed.ok) {
      const [title, body] = ERRORS[parsed.error];
      Alert.alert(title, body, [{ text: 'OK', onPress: () => resolve(false) }]);
      return;
    }
    const { psk, crewName } = parsed.invite;
    const id = crewIdFor(psk);
    const name = crewName || `Crew ${id}`;
    const current = useCrewKeyStore.getState().crew;
    if (current?.id === id) {
      Alert.alert("You're already in this crew", name, [{ text: 'OK', onPress: () => resolve(false) }]);
      return;
    }
    if (!useCrewKeyStore.getState().model2) useCrewKeyStore.getState().setModel2(true);
    Alert.alert(
      `Join ${name}?`,
      (current ? `You'll leave ${current.displayName}. ` : '') + 'Your radio restarts to switch (about 15 seconds).',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Join',
          onPress: async () => {
            const now = await joinCrew(psk, crewName);
            Alert.alert(
              `You're in ${name}`,
              now ? 'Your radio is restarting and reconnects in about 15 seconds.' : 'Your radio switches the next time it connects.',
            );
            resolve(true);
          },
        },
      ],
    );
  });
}
