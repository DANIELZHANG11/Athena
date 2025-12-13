// Radix UI module stubs
declare module '@radix-ui/react-alert-dialog';
declare module '@radix-ui/react-dialog' {
  import * as React from 'react';
  export const Root: React.FC<any>;
  export const Trigger: React.FC<any>;
  export const Portal: React.FC<any>;
  export const Overlay: React.FC<any>;
  export const Content: React.FC<any>;
  export const Title: React.FC<React.PropsWithChildren<any>>;
  export const Description: React.FC<React.PropsWithChildren<any>>;
  export const Close: React.FC<any>;
}
declare module '@radix-ui/react-label' {
  import * as React from 'react';
  export const Root: React.FC<React.PropsWithChildren<any>>;
}
declare module '@radix-ui/react-scroll-area' {
  import * as React from 'react';
  export const Root: React.FC<React.PropsWithChildren<any>>;
  export const Viewport: React.FC<React.PropsWithChildren<any>>;
  export const Scrollbar: React.FC<any>;
  export const ScrollAreaScrollbar: React.FC<any>;
  export const ScrollAreaThumb: React.FC<any>;
  export const Corner: React.FC<any>;
}

// Framer Motion types fix
declare module 'framer-motion' {
  import * as React from 'react';
  export interface MotionProps {
    initial?: any;
    animate?: any;
    exit?: any;
    transition?: any;
    whileInView?: any;
    whileHover?: any;
    viewport?: any;
    style?: React.CSSProperties;
    className?: string;
    children?: React.ReactNode;
    [key: string]: any;
  }
  export const motion: {
    div: React.FC<MotionProps & React.HTMLAttributes<HTMLDivElement>>;
    nav: React.FC<MotionProps & React.HTMLAttributes<HTMLElement>>;
    [key: string]: React.FC<any>;
  };
  export const AnimatePresence: React.FC<any>;
  export function useScroll(options?: any): any;
  export function useTransform(...args: any[]): any;
}