import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card, CardContent, CardHeader, CardTitle } from "./card";

const meta = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
  render: () => (
    <Card className="w-full max-w-sm gap-4">
      <CardHeader>
        <CardTitle>Card title</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Compact surface for grouped content.
      </CardContent>
    </Card>
  ),
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
