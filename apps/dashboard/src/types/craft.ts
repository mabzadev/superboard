export interface ButtonCraftProps {
  text?: string;
  background?: string;
  borderRadius?: string;
  paddingTop?: string;
  paddingBottom?: string;
  paddingRight?: string;
  paddingLeft?: string;
  marginTop?: string;
  marginBottom?: string;
  marginRight?: string;
  marginLeft?: string;
  margin?: string;
  textSize?: string;
  textColor?: string;
  textAlign?: string;
  href?: string;
  styleType?: string;
  borderSize?: string;
}

export interface TextCraftProps {
  text?: string;
  textSize?: string;
  textColor?: string;
  textAlign?: string;
  fontWeight?: string;
  marginTop?: string;
  marginBottom?: string;
  marginRight?: string;
  marginLeft?: string;
}

export interface ImageCraftProps {
  marginTop?: string;
  marginBottom?: string;
  marginRight?: string;
  marginLeft?: string;
  src?: string;
  alt?: string;
  minWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  maxWidth?: string;
}

export interface ContainerCraftProps {
  children?: React.ReactNode;
}

export interface RootContainerCraftProps {
  children?: React.ReactNode;
}
