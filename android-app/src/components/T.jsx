import React from 'react';
import { Text } from 'react-native';
import { colors, font } from '../theme';

const VARIANTS = {
  h1: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, color: colors.ink },
  h2: { fontFamily: font.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  h3: { fontFamily: font.semibold, fontSize: 15.5, lineHeight: 21, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: colors.text },
  strong: { fontFamily: font.semibold, fontSize: 14, lineHeight: 20, color: colors.ink },
  small: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: colors.muted },
  label: { fontFamily: font.semibold, fontSize: 12.5, lineHeight: 17, color: colors.ink },
  eyebrow: { fontFamily: font.semibold, fontSize: 11, lineHeight: 14, color: colors.faint, letterSpacing: 0.6, textTransform: 'uppercase' },
  big: { fontFamily: font.bold, fontSize: 26, lineHeight: 32, color: colors.ink }
};

/** Text in Inter, with the website's sizes. <T v="h2">Title</T> */
export default function T({ v = 'body', color, weight, center, style, children, ...rest }) {
  const base = VARIANTS[v] || VARIANTS.body;
  const extra = {};
  if (color) extra.color = color;
  if (weight) extra.fontFamily = font[weight] || base.fontFamily;
  if (center) extra.textAlign = 'center';
  return <Text style={[base, extra, style]} {...rest}>{children}</Text>;
}
