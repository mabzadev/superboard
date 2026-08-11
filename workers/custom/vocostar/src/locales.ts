const SAMPLE: Record<string, { audio: string; unlock: string }> = {
  fr: {
    audio:
      "Salut ! Je suis ton clone vocal sur VocoStar. Je peux maintenant parler avec ta voix.",
    unlock:
      "Débloque ton clone VocoStar pour transformer tes textes, vidéos et fichiers audio.",
  },
  es: {
    audio:
      "¡Hola! Soy tu clon de voz en VocoStar. Ahora puedo hablar con tu voz.",
    unlock:
      "Desbloquea tu clon VocoStar para transformar textos, vídeos y archivos de audio.",
  },
  pt: {
    audio:
      "Olá! Sou seu clone de voz no VocoStar. Agora posso falar com a sua voz.",
    unlock:
      "Desbloqueie seu clone VocoStar para transformar textos, vídeos e arquivos de áudio.",
  },
  de: {
    audio:
      "Hallo! Ich bin dein Stimmklon in VocoStar. Jetzt kann ich mit deiner Stimme sprechen.",
    unlock:
      "Schalte deinen VocoStar-Klon frei, um Text-, Video- und Audiodateien umzuwandeln.",
  },
  ja: {
    audio:
      "こんにちは。VocoStarの音声クローンです。あなたの声で話せるようになりました。",
    unlock:
      "VocoStarのクローンを解除して、テキスト、動画、音声を変換しましょう。",
  },
  ko: {
    audio:
      "안녕하세요. VocoStar 음성 클론입니다. 이제 당신의 목소리로 말할 수 있습니다.",
    unlock:
      "VocoStar 클론을 잠금 해제하여 텍스트, 비디오 및 오디오를 변환하세요.",
  },
  en: {
    audio:
      "Hi! I am your VocoStar voice clone. I can now speak with your voice.",
    unlock:
      "Unlock your VocoStar clone to transform text, video and audio files.",
  },
};

export function vocalSamples(language: string) {
  return SAMPLE[language] ?? SAMPLE.en;
}
