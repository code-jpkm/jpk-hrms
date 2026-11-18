import { Platform } from 'react-native';

// Same palette as the website (ui/styles/theme.css): JPK logo navy, orange and grey.
export const colors = {
  navy: '#1F3445',
  navy900: '#142330',
  navy600: '#2C4459',
  navy500: '#3E5568',
  navy400: '#5D7284',
  navy300: '#8C9DAB',
  navy200: '#C3CDD6',
  navy100: '#E1E7EC',
  navy50: '#EFF3F6',
  navy25: '#F6F8FA',
  orange: '#F38121',
  orange600: '#E27116',
  orange700: '#C4620E',
  orangeText: '#B85C10',
  orange300: '#F8B57D',
  orange200: '#FBD3B0',
  orange100: '#FDE7D4',
  orange50: '#FEF4EA',
  gray: '#807F84',
  gray900: '#29292C',
  gray800: '#3D3D41',
  gray700: '#55555A',
  gray600: '#6A6A6F',
  gray400: '#A2A1A6',
  gray300: '#C5C4C8',
  gray200: '#E1E1E4',
  gray150: '#EBEBED',
  gray100: '#F2F2F3',
  gray50: '#F7F7F8',
  bg: '#F4F5F7',
  surface: '#FFFFFF',
  line: '#E1E1E4',
  lineStrong: '#C5C4C8',
  ink: '#1F3445',
  text: '#3D3D41',
  muted: '#6A6A6F',
  faint: '#807F84',
  green: '#2E7D4F',
  greenSoft: '#E8F3EC',
  white: '#FFFFFF'
};

// Inter, like the website. Android cannot fake bold for a custom font, so each weight is its own family.
export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold'
};

export const radius = { sm: 6, md: 10, lg: 12, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

export function shadow(level = 1) {
  if (Platform.OS === 'android') return { elevation: level === 1 ? 1 : level === 2 ? 4 : 10 };
  return level === 1
    ? { shadowColor: colors.navy, shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }
    : level === 2
      ? { shadowColor: colors.navy, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }
      : { shadowColor: colors.navy, shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } };
}
