
package com.akusera.mikuplayreburn;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(
    name = "MediaPicker"
)
public class MediaPickerPlugin extends Plugin {

    private static final int REQUEST_CODE_PICK_MEDIA = 2001;

    @PluginMethod
    // 打开系统媒体选择器选择图片或视频
    public void pickMedia(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_PICK);
            intent.setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*,video/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
            startActivityForResult(call, intent, "handlePickResult");
        } catch (Exception e) {
            call.reject("无法打开媒体选择器: " + e.getMessage());
        }
    }

    @ActivityCallback
    // 处理媒体选择结果
    private void handlePickResult(PluginCall call, ActivityResult result) {
        if (result == null || result.getData() == null) {
            call.reject("未选择任何媒体");
            return;
        }

        if (result.getResultCode() != getActivity().RESULT_OK) {
            call.reject("媒体选择已取消");
            return;
        }

        try {
            Uri uri = result.getData().getData();
            if (uri == null) {
                call.reject("无法获取媒体URI");
                return;
            }

            JSObject mediaInfo = getMediaInfo(uri);
            if (mediaInfo == null) {
                call.reject("无法获取媒体信息");
                return;
            }

            call.resolve(mediaInfo);
        } catch (Exception e) {
            call.reject("处理媒体文件失败: " + e.getMessage());
        }
    }

    // 获取媒体文件信息（类型、尺寸、路径等）
    private JSObject getMediaInfo(Uri uri) {
        JSObject result = new JSObject();
        ContentResolver resolver = getContext().getContentResolver();

        String mimeType = resolver.getType(uri);
        if (mimeType == null) {
            mimeType = getMimeTypeFromUri(uri);
        }

        result.put("uri", uri.toString());
        result.put("mimeType", mimeType);

        boolean isVideo = mimeType != null && mimeType.startsWith("video/");
        result.put("mediaType", isVideo ? "video" : "image");

        int width = 0;
        int height = 0;

        if (isVideo) {
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                retriever.setDataSource(getContext(), uri);
                String w = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
                String h = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                if (w != null && h != null) {
                    width = Integer.parseInt(w);
                    height = Integer.parseInt(h);
                }
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                try {
                    retriever.release();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        } else {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            try {
                java.io.InputStream is = resolver.openInputStream(uri);
                if (is != null) {
                    BitmapFactory.decodeStream(is, null, options);
                    is.close();
                    width = options.outWidth;
                    height = options.outHeight;
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        result.put("width", width);
        result.put("height", height);

        String absolutePath = getAbsolutePathFromUri(uri);
        result.put("absolutePath", absolutePath != null ? absolutePath : uri.toString());

        return result;
    }

    // 从Uri获取文件绝对路径
    private String getAbsolutePathFromUri(Uri uri) {
        String[] projection = { MediaStore.Images.Media.DATA };
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(uri, projection, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int columnIndex = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA);
                return cursor.getString(columnIndex);
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return null;
    }

    // 从Uri获取MIME类型
    private String getMimeTypeFromUri(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        String mimeType = resolver.getType(uri);
        if (mimeType == null) {
            String extension = getFileExtension(uri);
            if (extension != null) {
                mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase());
            }
        }
        return mimeType != null ? mimeType : "application/octet-stream";
    }

    // 从Uri获取文件扩展名
    private String getFileExtension(Uri uri) {
        String path = uri.getPath();
        if (path != null) {
            int lastDot = path.lastIndexOf('.');
            if (lastDot != -1) {
                return path.substring(lastDot + 1);
            }
        }
        return null;
    }
}
