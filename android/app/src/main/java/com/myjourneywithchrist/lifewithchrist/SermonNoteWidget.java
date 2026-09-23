package com.myjourneywithchrist.lifewithchrist;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * A home-screen doorway into a sermon note.
 *
 * Deliberately the plainest thing that works: a classic AppWidgetProvider and
 * a RemoteViews layout, with no new dependency. Glance would have meant
 * bringing Compose into this project to draw one button, and the button does
 * not need it.
 *
 * It is a doorway, not a feature. Everything about what a sermon note IS — the
 * editor, the kind, the focus, the crash-safe draft — already exists and is
 * reached by naming ONE action that the web layer validates. This class knows
 * the name and nothing else: not the route, not the hash, not what the editor
 * does when it gets there.
 *
 * Nothing here reads the journal. There is no periodic update (see
 * res/xml/sermon_note_widget_info.xml), so this code runs when the widget is
 * placed or the system asks for a redraw, and at no other time.
 */
public class SermonNoteWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            manager.updateAppWidget(widgetId, build(context, widgetId));
        }
    }

    private static RemoteViews build(Context context, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_sermon_note);
        views.setOnClickPendingIntent(R.id.widget_root, tapIntent(context, widgetId));
        return views;
    }

    /**
     * What a tap sends, and how little it is allowed to be.
     *
     * Three deliberate choices:
     *
     * `setClass` makes the intent EXPLICIT. Without it this is an implicit
     * VIEW intent for a URI, which any application declaring the same scheme
     * could answer — a person's sermon note opening in somebody else's app.
     *
     * `FLAG_IMMUTABLE` means the PendingIntent handed to the launcher cannot
     * have its contents rewritten by whoever holds it. There is nothing here
     * worth rewriting, which is the point: the payload is one action name, the
     * same one every time.
     *
     * The widget id is the request code, so two copies of the widget keep
     * their own PendingIntents rather than silently sharing one.
     */
    private static PendingIntent tapIntent(Context context, int widgetId) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setClass(context, MainActivity.class);
        intent.setData(Uri.parse(context.getString(R.string.widget_sermon_note_url)));

        return PendingIntent.getActivity(
                context,
                widgetId,
                intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
