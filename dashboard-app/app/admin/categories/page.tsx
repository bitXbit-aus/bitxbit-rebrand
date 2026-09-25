import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createCategory } from "@/lib/actions";

export default async function AdminCategoriesPage() {
  const supabase = createClient();
  const { data: categories } = await supabase.from("categories").select("*").order("display_order");

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Categories</h1>
        <p className="text-muted-foreground mt-1">Organise affiliate offers by category.</p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Add Category</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createCategory} className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Name</label>
              <input name="name" className="input w-full" placeholder="Category name" required />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Slug</label>
              <input name="slug" className="input w-full" placeholder="category-slug" required />
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium mb-1">Order</label>
              <input name="displayOrder" type="number" defaultValue={0} className="input w-full" />
            </div>
            <Button type="submit">Add</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Order</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {categories?.map((cat) => (
                <tr key={cat.id}>
                  <td className="font-medium">{cat.name}</td>
                  <td>{cat.slug}</td>
                  <td>{cat.display_order}</td>
                  <td>{cat.active ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
