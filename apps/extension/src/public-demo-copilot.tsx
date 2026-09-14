import type {PropsWithChildren} from 'react';

/**
 * The anonymous judge demo never exposes free-form CopilotKit chat. Keeping a
 * tiny build-time replacement lets the public container avoid shipping the
 * full chat renderer while normal extension and private-hosted builds retain it.
 */
export function CopilotKitProvider({children}:PropsWithChildren<Record<string,unknown>>){
  return <>{children}</>;
}

export function CopilotBindings(_props:Record<string,unknown>){
  return null;
}

export function LiveChat(){
  return null;
}
