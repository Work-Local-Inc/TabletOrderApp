// Augment React Native TouchableWithoutFeedbackProps to include nativeID,
// which is missing from the type definitions in RN 0.81.5 but is a valid prop.
import 'react-native';

declare module 'react-native' {
  interface TouchableWithoutFeedbackProps {
    nativeID?: string;
  }
}
