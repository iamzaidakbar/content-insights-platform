import { Switch } from '@/components/ui/switch';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export default function Toggle({ checked, onChange, label }: ToggleProps) {
  return <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />;
}
