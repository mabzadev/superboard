/* eslint-disable react-native/no-inline-styles */
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  Button,
  Clipboard,
} from 'react-native';
import OpenGrow from '@mbzadev/opengrow-react-native-sdk';
import { useEffect, useState } from 'react';

OpenGrow.setIdentifier('React native id');
OpenGrow.setAttributes({
  'string': 'string value',
  'boolean': true,
  'number': 13,
  'number 2': 13.2,
  'array': ['1', 2, true],
});

export default function App() {
  useEffect(() => {
    fetchUnreadMessages();

    const listener = OpenGrow.onDeeplinkReceived((data) => {
      console.log(`Opened link data: ${JSON.stringify(data)}`);
      setLabel1(`Opened link data: ${JSON.stringify(data)}`);
    });

    return () => {
      listener.remove(); // Stop receiving events
    };
  }, []);

  const [label1, setLabel1] = useState('Opened link data:');
  const [label2, setLabel2] = useState('Generated link:');
  const [label3, setLabel3] = useState('Unread messages:');
  const [label4, setLabel4] = useState('Revenue:');

  const handleGenerateLinkPress = () => {
    generateLink();
  };

  const handleShowNotificationsPress = () => {
    OpenGrow.displayMessages();
  };

  const copyToClipboard = (text: string) => {
    Clipboard.setString(text);
    console.log(`Copied: "${text}"`);
  };

  async function generateLink() {
    try {
      const link = await OpenGrow.generateLink(
        'Test link',
        'Test subtitle',
        undefined,
        { age: 25, city: 'New York' },
        undefined,
        {
          android: {
            link: 'https://example.com/android',
            open_if_app_installed: true,
          },
          ios: {
            link: 'https://example.com/ios',
            open_if_app_installed: true,
          },
          desktop: {
            link: 'https://example.com/desktop',
            open_if_app_installed: true,
          },
        },
        false,
        false,
        {
          utm_medium: 'social',
          utm_source: 'social_network',
          utm_campaign: 'react_native_integration',
        }
      );
      console.log(`Generated link: ${link}`);
      setLabel2(`Generated link: ${link}`);
    } catch (error) {
      console.log('Error generating link:', error);
    }
  }

  async function handleLogInAppPurchase() {
    try {
      const success = await OpenGrow.logInAppPurchase('123456789');
      setLabel4(`In-app purchase: ${success}`);
      console.log('In-app purchase tracked:', success);
    } catch (error) {
      setLabel4(`In-app purchase error: ${error}`);
      console.log('Error tracking in-app purchase:', error);
    }
  }

  async function handleLogCustomPurchase() {
    try {
      const success = await OpenGrow.logCustomPurchase(
        'buy',
        999,
        'USD',
        'premium_monthly'
      );
      setLabel4(`Custom purchase: ${success}`);
      console.log('Custom purchase tracked:', success);
    } catch (error) {
      setLabel4(`Custom purchase error: ${error}`);
      console.log('Error tracking custom purchase:', error);
    }
  }

  async function fetchUnreadMessages() {
    try {
      const unreadCount = await OpenGrow.numberOfUnreadMessages();
      console.log(`Unread messages: ${unreadCount}`);
      setLabel3(`Unread messages: ${unreadCount}`);
    } catch (error) {
      console.log('Error fetching unread messages:', error);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{label1}</Text>
        <TouchableOpacity
          onPress={() => copyToClipboard(label1)}
          style={styles.copyButton}
        >
          <Text style={styles.copyText}>📋</Text>
        </TouchableOpacity>
      </View>
      <View style={{ height: 20 }} />
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{label2}</Text>
        <TouchableOpacity
          onPress={() => copyToClipboard(label2)}
          style={styles.copyButton}
        >
          <Text style={styles.copyText}>📋</Text>
        </TouchableOpacity>
      </View>
      <View style={{ height: 20 }} />
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{label3}</Text>
        <TouchableOpacity
          onPress={() => copyToClipboard(label3)}
          style={styles.copyButton}
        >
          <Text style={styles.copyText}>📋</Text>
        </TouchableOpacity>
      </View>
      <View style={{ height: 20 }} />
      <Button title="Generate link" onPress={handleGenerateLinkPress} />
      <View style={{ height: 20 }} />
      <Button
        title="Show notifications"
        onPress={handleShowNotificationsPress}
      />
      <View style={{ height: 20 }} />
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{label4}</Text>
      </View>
      <Button title="Log in-app purchase" onPress={handleLogInAppPurchase} />
      <View style={{ height: 10 }} />
      <Button title="Log custom purchase" onPress={handleLogCustomPurchase} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '90%',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  label: {
    fontSize: 18,
    marginRight: 10,
  },
  copyButton: {
    padding: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
  },
  copyText: {
    fontSize: 18,
  },
});
