declare module 'qrcode' {
  export function toString(
    text: string,
    options: {
      type: 'svg';
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      margin?: number;
      width?: number;
    }
  ): Promise<string>;
}
