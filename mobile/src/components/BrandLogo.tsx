// ─────────────────────────────────────────────────────────────────────────────
//  components/BrandLogo.tsx — Brand logo image with initials fallback
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { View, Text, Image } from 'react-native';
import { colors, typography } from '@/theme';
import { getBrandLogo, getBrandInitials } from '@/constants/brandLogos';

interface Props {
  slug:        string;
  name:        string;
  size?:       number;
  borderRadius?: number;
}

export default function BrandLogo({ slug, name, size = 40, borderRadius }: Props) {
  const [failed, setFailed] = useState(false);
  const logoUrl = getBrandLogo(slug);
  const br = borderRadius ?? size * 0.25;

  const containerStyle = {
    width: size, height: size, borderRadius: br,
    backgroundColor: colors.bgPanel,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  };

  if (logoUrl && !failed) {
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri: logoUrl }}
          style={{ width: size - 4, height: size - 4, borderRadius: br - 2 }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  // Initials fallback
  const initials = getBrandInitials(name);
  const fontSize = size <= 32 ? 11 : size <= 44 ? 14 : 18;

  return (
    <View style={[containerStyle, { backgroundColor: colors.bgBlue }]}>
      <Text style={{
        fontSize,
        fontWeight: '700',
        color: colors.primary,
        fontFamily: 'Heebo_700Bold',
      }}>
        {initials}
      </Text>
    </View>
  );
}
