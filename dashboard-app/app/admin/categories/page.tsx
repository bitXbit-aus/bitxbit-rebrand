import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createCategory, updateCategory, deleteCategory } from "@/lib/actions";

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
        <CardHeader>
          <CardTitle>Manage Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {categories?.map((cat) => (
              <div key={cat.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 rounded-lg border border-border bg-card/50 items-end">
                <form action={updateCategory.bind(null, cat.id)} className="contents">
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                    <input name="name" defaultValue={cat.name} className="input w-full" required />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Slug</label>
                    <input name="slug" defaultValue={cat.slug} className="input w-full" required />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Order</label>
                    <input name="displayOrder" type="number" defaultValue={cat.display_order} className="input w-full" />
                  </div>
                  <div className="md:col-span-2 flex items-center pb-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={cat.active} />
                      Active
                    </label>
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <Button type="submit" size="sm">Save</Button>
                  </div>
                </form>
                <div className="md:col-span-12 flex justify-end border-t border-border pt-3">
                  <form action={deleteCategory.bind(null, cat.id)}>
                    <Button variant="destructive" size="sm" type="submit">Delete Category</Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
