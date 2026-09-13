import { TextField } from "./ui";
export function DateField({
  label,
  value,
  onChange,
  mode = "date",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode?: "date" | "time";
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder={mode === "date" ? "YYYY-MM-DD" : "HH:mm"}
      hint={mode === "date" ? "YYYY-MM-DD" : "24-hour time"}
      autoCapitalize="none"
      maxLength={mode === "date" ? 10 : 5}
    />
  );
}
