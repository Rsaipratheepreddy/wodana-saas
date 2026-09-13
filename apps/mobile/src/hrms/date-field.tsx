import { useState } from "react";
import { Platform, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useTheme } from "../design-system";
import { Button, FieldTrigger } from "./ui";
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
  const [open, setOpen] = useState(false),
    { colors, mode: themeMode } = useTheme(),
    date =
      mode === "date"
        ? new Date(`${value}T12:00:00`)
        : new Date(`2000-01-01T${value}:00`),
    pad = (n: number) => String(n).padStart(2, "0");
  return (
    <View style={{ gap: 8 }}>
      <FieldTrigger
        label={label}
        value={value}
        expanded={open}
        icon={mode === 'date' ? 'calendar' : 'clock'}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <>
          <DateTimePicker
            accentColor={colors.actionPrimary}
            textColor={colors.text}
            themeVariant={themeMode === 'dark' ? 'dark' : 'light'}
            value={Number.isNaN(date.getTime()) ? new Date() : date}
            mode={mode}
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(event, next) => {
              if (Platform.OS !== "ios") setOpen(false);
              if (event.type === "set" && next)
                onChange(
                  mode === "date"
                    ? `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
                    : `${pad(next.getHours())}:${pad(next.getMinutes())}`,
                );
            }}
          />
          {Platform.OS === "ios" ? (
            <Button
              label="Done"
              variant="ghost"
              onPress={() => setOpen(false)}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
