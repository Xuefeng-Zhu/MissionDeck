import {cloneElement,isValidElement,useId,type ButtonHTMLAttributes,type ReactElement,type ReactNode} from 'react';
import { LoaderCircle } from 'lucide-react';

export function Button({children, variant='primary', busy=false, className='', ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {variant?: 'primary'|'secondary'|'ghost'|'danger'; busy?: boolean}) {
  return <button {...props} disabled={props.disabled || busy} className={`button button--${variant} ${className}`}>
    {busy && <LoaderCircle size={15} className="spin" aria-hidden="true"/>}{children}
  </button>;
}
export function Badge({children, tone='neutral'}: {children: ReactNode; tone?: 'neutral'|'blue'|'green'|'amber'|'red'}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
export function Notice({children, tone='neutral'}: {children: ReactNode; tone?: 'neutral'|'blue'|'amber'|'red'}) {
  return <div role={tone === 'red' ? 'alert' : 'status'} className={`notice notice--${tone}`}>{children}</div>;
}
export function Field({label, children, help}: {label:string; children: ReactNode; help?:string}) {
  const generatedId=useId();
  const child=isValidElement(children)?children as ReactElement<{id?:string;'aria-describedby'?:string}>:null;
  const controlId=child?.props.id||generatedId;
  const helpId=`${controlId}-description`;
  return <div className="field"><label htmlFor={controlId}>{label}</label>{child?cloneElement(child,{id:controlId,'aria-describedby':[child.props['aria-describedby'],help?helpId:undefined].filter(Boolean).join(' ')||undefined}):children}{help && <small id={helpId}>{help}</small>}</div>;
}
