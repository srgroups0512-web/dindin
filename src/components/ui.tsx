import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Svg, {Circle, Path, Rect} from 'react-native-svg';
import {colors, radii} from '../theme';

const mascot = require('../assets/dindin-penguin.png');

type IconName =
  | 'home'
  | 'calendar'
  | 'activity'
  | 'settings'
  | 'plus'
  | 'phone'
  | 'message'
  | 'clock'
  | 'bell'
  | 'chevron'
  | 'back'
  | 'check'
  | 'shield'
  | 'whatsapp'
  | 'person'
  | 'logout';

export function Icon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const strokeWidth = 1.9;
  const common = {
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' && (
        <>
          <Path d="M3 11.5 12 4l9 7.5" {...common} />
          <Path d="M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6" {...common} />
        </>
      )}
      {name === 'calendar' && (
        <>
          <Rect x="3" y="5" width="18" height="16" rx="3" {...common} />
          <Path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" {...common} />
        </>
      )}
      {name === 'activity' && (
        <>
          <Path d="M5 4v16M5 7h14M5 12h11M5 17h8" {...common} />
          <Circle cx="5" cy="7" r="1.6" fill={color} />
          <Circle cx="5" cy="12" r="1.6" fill={color} />
          <Circle cx="5" cy="17" r="1.6" fill={color} />
        </>
      )}
      {name === 'settings' && (
        <>
          <Path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" {...common} />
          <Circle cx="16" cy="6" r="2" {...common} />
          <Circle cx="8" cy="12" r="2" {...common} />
          <Circle cx="14" cy="18" r="2" {...common} />
        </>
      )}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...common} />}
      {name === 'phone' && <Path d="M7.2 3.5 10 7.7 8.3 9.4c1.3 2.7 3.3 4.7 6 6l1.8-1.7 4.2 2.8c.5.3.7.9.5 1.4l-.6 2c-.2.6-.8 1-1.5 1C10.2 20.2 3.8 13.8 3 5.3c-.1-.7.3-1.3 1-1.5l2-.6c.5-.2 1 .0 1.2.3Z" {...common} />}
      {name === 'message' && <Path d="M4 5.5h16v11H9l-5 4v-15Z" {...common} />}
      {name === 'clock' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="M12 7v5l3.5 2" {...common} />
        </>
      )}
      {name === 'bell' && <Path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 20h4" {...common} />}
      {name === 'chevron' && <Path d="m9 5 7 7-7 7" {...common} />}
      {name === 'back' && (
        <>
          <Path d="m10.5 6-6 6 6 6" {...common} />
          <Path d="M5 12h14.5" {...common} />
        </>
      )}
      {name === 'check' && <Path d="m5 12 4.2 4.2L19 6.5" {...common} />}
      {name === 'shield' && <Path d="M12 3 20 6v5c0 5.2-3.2 8.2-8 10-4.8-1.8-8-4.8-8-10V6l8-3Z" {...common} />}
      {name === 'whatsapp' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="m7 20 1-3.2A7 7 0 1 1 10 19" {...common} />
          <Path d="M9 8.5c.8 3 2.2 4.4 5.2 5.2" {...common} />
        </>
      )}
      {name === 'person' && (
        <>
          <Circle cx="12" cy="8" r="4" {...common} />
          <Path d="M4.5 21c.7-4.2 3.1-6.3 7.5-6.3s6.8 2.1 7.5 6.3" {...common} />
        </>
      )}
      {name === 'logout' && (
        <>
          <Path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10" {...common} />
          <Path d="M13 8l4 4-4 4M8 12h9" {...common} />
        </>
      )}
    </Svg>
  );
}

function AmbientBackground() {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 7000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 7000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [drift]);

  const left = drift.interpolate({inputRange: [0, 1], outputRange: [-18, 18]});
  const right = drift.interpolate({inputRange: [0, 1], outputRange: [12, -14]});

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.blob, styles.blobTop, {transform: [{translateX: left}]}]} />
      <Animated.View style={[styles.blob, styles.blobBottom, {transform: [{translateX: right}]}]} />
      <View style={styles.dotOne} />
      <View style={styles.dotTwo} />
    </View>
  );
}

export function AppShell({
  children,
  scroll = true,
  keyboard = false,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  keyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {toValue: 1, duration: 360, useNativeDriver: true}),
      Animated.spring(rise, {toValue: 0, damping: 18, stiffness: 150, useNativeDriver: true}),
    ]).start();
  }, [fade, rise]);

  const content = (
    <Animated.View style={[styles.screenContent, contentStyle, {opacity: fade, transform: [{translateY: rise}]}]}>
      {children}
    </Animated.View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <AmbientBackground />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets={keyboard && Platform.OS === 'ios'}
            showsVerticalScrollIndicator={false}>
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function FloatingMascot({size = 190}: {size?: number}) {
  const float = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const floatAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true}),
        Animated.timing(float, {toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true}),
      ]),
    );
    const breatheAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {toValue: 1, duration: 2200, useNativeDriver: true}),
        Animated.timing(breathe, {toValue: 0, duration: 2200, useNativeDriver: true}),
      ]),
    );
    floatAnimation.start();
    breatheAnimation.start();
    return () => {
      floatAnimation.stop();
      breatheAnimation.stop();
    };
  }, [breathe, float]);
  return (
    <View style={[styles.mascotWrap, {width: size + 40, height: size + 40}]}>
      <Animated.View
        style={[
          styles.mascotHalo,
          {
            width: size * 0.9,
            height: size * 0.9,
            borderRadius: size,
            opacity: breathe.interpolate({inputRange: [0, 1], outputRange: [0.45, 0.8]}),
            transform: [{scale: breathe.interpolate({inputRange: [0, 1], outputRange: [0.94, 1.08]})}],
          },
        ]}
      />
      <Animated.Image
        source={mascot}
        resizeMode="contain"
        style={{
          width: size,
          height: size,
          transform: [
            {translateY: float.interpolate({inputRange: [0, 1], outputRange: [4, -8]})},
            {rotate: float.interpolate({inputRange: [0, 1], outputRange: ['-1.5deg', '1.5deg']})},
          ],
        }}
      />
    </View>
  );
}

export function Brand({compact = false}: {compact?: boolean}) {
  return (
    <View style={styles.brandRow}>
      {compact && <Image source={mascot} style={styles.brandMascot} resizeMode="contain" />}
      <Text style={[styles.brandText, compact && styles.brandTextCompact]}>Din Din</Text>
      <View style={styles.brandSpark} />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  icon?: IconName;
  testID?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (value: number) =>
    Animated.spring(scale, {toValue: value, damping: 14, stiffness: 260, useNativeDriver: true}).start();
  return (
    <Animated.View style={[styles.buttonMotion, disabled && styles.buttonDisabled, {transform: [{scale}]}]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPressIn={() => animate(0.975)}
        onPressOut={() => animate(1)}
        onPress={onPress}
        style={[styles.button, styles[`button_${variant}`]]}>
        {icon && (
          <Icon
            name={icon}
            size={20}
            color={variant === 'secondary' || variant === 'ghost' ? colors.ink : colors.white}
          />
        )}
        <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function Field({
  label,
  hint,
  prefix,
  error,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & {label: string; hint?: string; prefix?: string; error?: string}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.fieldGroup}>
      <View style={[styles.field, focused && styles.fieldFocused, error && styles.fieldError]}>
        <Text style={[styles.fieldLabel, focused && styles.fieldLabelFocused, error && styles.fieldLabelError]}>
          {label}
        </Text>
        <View style={styles.fieldInputRow}>
          {prefix ? (
            <View style={styles.fieldPrefixWrap}>
              <Text style={styles.fieldPrefix}>{prefix}</Text>
              <View style={styles.fieldPrefixDivider} />
            </View>
          ) : null}
          <TextInput
            {...props}
            onFocus={event => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={event => {
              setFocused(false);
              onBlur?.(event);
            }}
            placeholderTextColor="#91A3AC"
            style={[styles.fieldInput, props.style]}
            selectionColor={colors.teal}
          />
        </View>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function ScreenHeader({title, subtitle, onBack, action}: {title: string; subtitle?: string; onBack?: () => void; action?: React.ReactNode}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({pressed}) => [styles.iconButton, pressed && styles.iconButtonPressed]}
            hitSlop={10}>
            <Icon name="back" size={21} color={colors.tealDark} />
          </Pressable>
        ) : (
          <View style={styles.iconPlaceholder} />
        )}
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
        </View>
        {action ?? <View style={styles.iconPlaceholder} />}
      </View>
    </View>
  );
}

export function SelectChip({label, selected, onPress}: {label: string; selected: boolean; onPress: () => void}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{selected}}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}>
      {selected && <View style={styles.chipDot} />}
      <Text numberOfLines={1} style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function BottomNav({active, onSelect}: {active: 'home' | 'circle' | 'settings'; onSelect: (value: 'home' | 'circle' | 'settings') => void}) {
  const items: {key: 'home' | 'circle' | 'settings'; label: string; icon: IconName}[] = [
    {key: 'home', label: 'My Check-in', icon: 'home'},
    {key: 'circle', label: 'My Circle', icon: 'person'},
    {key: 'settings', label: 'Settings', icon: 'settings'},
  ];
  return (
    <View style={styles.bottomNav}>
      {items.map(item => {
        const selected = item.key === active;
        return (
          <Pressable key={item.key} testID={`tab-${item.key}`} onPress={() => onSelect(item.key)} style={styles.navItem} accessibilityRole="tab" accessibilityState={{selected}}>
            <View style={[styles.navIcon, selected && styles.navIconSelected]}>
              <Icon name={item.icon} size={21} color={selected ? colors.white : colors.muted} />
            </View>
            <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyCircleArt() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(pulse, {toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true}),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  return (
    <View style={styles.emptyArt}>
      <Animated.View style={[styles.pulseRing, {opacity: pulse.interpolate({inputRange: [0, 1], outputRange: [0.45, 0]}), transform: [{scale: pulse.interpolate({inputRange: [0, 1], outputRange: [0.7, 1.4]})}]}]} />
      <View style={styles.emptyArtCenter}>
        <Icon name="plus" size={32} color={colors.teal} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  safeArea: {flex: 1, backgroundColor: colors.cream},
  scrollContent: {flexGrow: 1},
  screenContent: {flexGrow: 1, paddingHorizontal: 22, paddingBottom: 18},
  blob: {position: 'absolute', borderRadius: 999},
  blobTop: {width: 230, height: 230, right: -80, top: -95, backgroundColor: '#D9F3ED'},
  blobBottom: {width: 280, height: 190, left: -120, bottom: -70, backgroundColor: '#E2F3F7'},
  dotOne: {position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFD480', right: 38, top: 170},
  dotTwo: {position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: '#74D8CB', left: 28, top: 115},
  mascotWrap: {alignSelf: 'center', alignItems: 'center', justifyContent: 'center'},
  mascotHalo: {position: 'absolute', backgroundColor: '#CDEFE8'},
  brandRow: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center'},
  brandMascot: {width: 38, height: 38, marginRight: 8},
  brandText: {fontSize: 42, lineHeight: 48, color: colors.navy, fontWeight: '900', letterSpacing: -1.8},
  brandTextCompact: {fontSize: 26, lineHeight: 32, letterSpacing: -0.8},
  brandSpark: {width: 8, height: 8, borderRadius: 2, backgroundColor: colors.coral, marginLeft: 5, marginTop: -19, transform: [{rotate: '24deg'}]},
  button: {minHeight: 56, borderRadius: radii.md, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, borderWidth: 1},
  buttonMotion: {opacity: 1},
  buttonDisabled: {opacity: 0.5},
  button_primary: {backgroundColor: colors.tealDark, borderColor: colors.tealDark, shadowColor: colors.shadow, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: {width: 0, height: 7}, elevation: 4},
  button_secondary: {backgroundColor: 'rgba(255,255,255,0.82)', borderColor: '#C7D8DA'},
  button_danger: {backgroundColor: colors.coral, borderColor: colors.coral},
  button_ghost: {backgroundColor: 'transparent', borderColor: 'transparent', minHeight: 48},
  buttonText: {fontSize: 16, fontWeight: '800'},
  buttonText_primary: {color: colors.white},
  buttonText_secondary: {color: colors.ink},
  buttonText_danger: {color: colors.white},
  buttonText_ghost: {color: colors.tealDark},
  fieldGroup: {gap: 6},
  field: {minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: '#C9D9DC', backgroundColor: 'rgba(255,255,255,0.96)', paddingTop: 9, overflow: 'hidden', shadowColor: colors.shadow, shadowOpacity: 0.045, shadowRadius: 7, shadowOffset: {width: 0, height: 3}, elevation: 1},
  fieldFocused: {borderColor: colors.teal, borderWidth: 1.5, shadowColor: colors.tealDark, shadowOpacity: 0.09, elevation: 2},
  fieldError: {borderColor: colors.coral, backgroundColor: '#FFFBFA'},
  fieldLabel: {fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 0.35, color: '#66808A', paddingHorizontal: 16},
  fieldLabelFocused: {color: colors.tealDark},
  fieldLabelError: {color: '#BD3F39'},
  fieldInputRow: {minHeight: 47, flexDirection: 'row', alignItems: 'center'},
  fieldPrefixWrap: {height: 32, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, gap: 13},
  fieldPrefix: {fontSize: 16, fontWeight: '800', color: colors.tealDark},
  fieldPrefixDivider: {width: 1, height: 25, backgroundColor: '#D5E2E3'},
  fieldInput: {flex: 1, minHeight: 45, color: colors.ink, fontSize: 16, fontWeight: '600', paddingHorizontal: 16, paddingTop: 3, paddingBottom: 9},
  hint: {fontSize: 12, lineHeight: 17, color: colors.muted, paddingHorizontal: 4},
  errorText: {fontSize: 12, lineHeight: 17, color: '#BD3F39', fontWeight: '600', paddingHorizontal: 4},
  header: {paddingTop: 7, paddingBottom: 16},
  headerTop: {minHeight: 52, flexDirection: 'row', alignItems: 'center'},
  headerTitleWrap: {flex: 1, paddingHorizontal: 12},
  headerTitle: {fontSize: 26, lineHeight: 32, color: colors.ink, fontWeight: '900', letterSpacing: -0.7},
  headerSubtitle: {fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 2},
  iconButton: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft, borderWidth: 1, borderColor: '#B9E7DB', shadowColor: colors.shadow, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: {width: 0, height: 3}, elevation: 2},
  iconButtonPressed: {opacity: 0.72, transform: [{scale: 0.96}]},
  iconPlaceholder: {width: 42, height: 42},
  chip: {minHeight: 48, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: 'rgba(255,255,255,0.78)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, gap: 6},
  chipSelected: {borderColor: colors.teal, backgroundColor: colors.mintSoft},
  chipDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal},
  chipText: {fontSize: 13, color: colors.inkSoft, fontWeight: '800', textAlign: 'center'},
  chipTextSelected: {color: colors.tealDark},
  bottomNav: {marginHorizontal: 16, marginTop: 8, marginBottom: 4, minHeight: 68, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.98)', borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-around', paddingHorizontal: 5, paddingVertical: 6, shadowColor: colors.shadow, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: {width: 0, height: 5}, elevation: 7},
  navItem: {flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 17},
  navIcon: {width: 40, height: 29, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  navIconSelected: {backgroundColor: colors.tealDark},
  navLabel: {fontSize: 11, color: colors.muted, fontWeight: '700'},
  navLabelSelected: {color: colors.tealDark},
  emptyArt: {width: 150, height: 150, alignSelf: 'center', alignItems: 'center', justifyContent: 'center'},
  pulseRing: {position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: colors.teal},
  emptyArtCenter: {width: 82, height: 82, borderRadius: 41, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', shadowColor: colors.teal, shadowOpacity: 0.18, shadowRadius: 16, elevation: 3},
});

