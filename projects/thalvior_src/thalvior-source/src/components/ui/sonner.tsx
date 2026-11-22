import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      duration={2500}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-fg group-[.toaster]:border-border group-[.toaster]:shadow-lift group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-fg-muted",
          title: "group-[.toast]:text-fg group-[.toast]:font-medium",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-fg-muted group-[.toast]:rounded-md",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
