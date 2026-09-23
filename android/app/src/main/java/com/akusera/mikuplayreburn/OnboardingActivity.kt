package com.akusera.mikuplayreburn

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import android.graphics.Typeface
import android.text.Html
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.tooling.preview.Preview
import com.akusera.mikuplayreburn.ui.theme.OnboardingTheme

class OnboardingActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (OnboardingState.isCompleted(this)) {
            launchMainActivity()
            return
        }

        setContent {
            OnboardingTheme {
                OnboardingScreen(
                    onFinish = {
                        OnboardingState.markCompleted(this@OnboardingActivity)
                        launchMainActivity()
                    },
                    onSkip = {
                        OnboardingState.markCompleted(this@OnboardingActivity)
                        launchMainActivity()
                    }
                )
            }
        }
    }

    private fun launchMainActivity() {
        val intent = Intent(this, MainActivity::class.java)
        startActivity(intent)
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        finish()
    }
}

private data class QaItem(
    val question: Int,
    val answer: Int,
)

private val qaItems = listOf(
    //QaItem(R.string.onboarding_qa1_q, R.string.onboarding_qa1_a),
    QaItem(R.string.onboarding_qa2_q, R.string.onboarding_qa2_a),
    QaItem(R.string.onboarding_qa3_q, R.string.onboarding_qa3_a),
    QaItem(R.string.onboarding_qa4_q, R.string.onboarding_qa4_a),
    QaItem(R.string.onboarding_qa5_q, R.string.onboarding_qa5_a),
    QaItem( question=R.string.onboarding_qa6_q, answer=R.string.onboarding_qa6_a),
)

private data class TipItem(
    val title: Int,
    val body: Int,
)

private val tipItems = listOf(
    TipItem(R.string.onboarding_tip1_title, R.string.onboarding_tip1_body),
    TipItem(R.string.onboarding_tip2_title, R.string.onboarding_tip2_body),
    TipItem(R.string.onboarding_tip3_title, R.string.onboarding_tip3_body),
    TipItem(R.string.onboarding_tip4_title, R.string.onboarding_tip4_body),
    TipItem(R.string.onboarding_tip5_title, R.string.onboarding_tip5_body),
    TipItem(R.string.onboarding_tip6_title, R.string.onboarding_tip6_body),
)

private fun spannedToAnnotatedString(spanned: Spanned): AnnotatedString {
    val builder = AnnotatedString.Builder()
    builder.append(spanned.toString())

    val spans = spanned.getSpans(0, spanned.length, Any::class.java)
    for (span in spans) {
        val start = spanned.getSpanStart(span)
        val end = spanned.getSpanEnd(span)
        if (start == end) continue

        val style = when (span) {
            is StyleSpan -> {
                val fw = when (span.style) {
                    Typeface.BOLD -> FontWeight.Bold
                    Typeface.BOLD_ITALIC -> FontWeight.Bold
                    else -> null
                }
                val fs = when (span.style) {
                    Typeface.ITALIC -> FontStyle.Italic
                    Typeface.BOLD_ITALIC -> FontStyle.Italic
                    else -> null
                }
                SpanStyle(fontWeight = fw, fontStyle = fs)
            }
            is ForegroundColorSpan -> {
                SpanStyle(
                    color = Color(
                        red = (span.foregroundColor shr 16) and 0xff,
                        green = (span.foregroundColor shr 8) and 0xff,
                        blue = span.foregroundColor and 0xff,
                        alpha = (span.foregroundColor shr 24) and 0xff
                    )
                )
            }
            is AbsoluteSizeSpan -> {
                SpanStyle(fontSize = span.size.sp)
            }
            is UnderlineSpan -> {
                SpanStyle(textDecoration = TextDecoration.Underline)
            }
            else -> continue
        }
        builder.addStyle(style, start, end)
    }
    return builder.toAnnotatedString()
}

@Composable
private fun htmlStringResource(@androidx.annotation.StringRes id: Int): AnnotatedString {
    val context = LocalContext.current
    return remember(id) {
        val html = context.getString(id).replace("\n", "<br>")
        val spanned = Html.fromHtml(html, Html.FROM_HTML_MODE_COMPACT)
        spannedToAnnotatedString(spanned)
    }
}

private const val COOLDOWN_SECONDS = 3
private const val TOTAL_STEPS = 5

@Composable
private fun OnboardingScreen(
    onFinish: () -> Unit,
    onSkip: () -> Unit = {},
) {
    var currentStep by remember { mutableIntStateOf(0) }
    var isCoolingDown by remember { mutableStateOf(false) }
    var remainingSeconds by remember { mutableIntStateOf(COOLDOWN_SECONDS) }

    val isFirstStep = currentStep == 0
    val isLastStep = currentStep == TOTAL_STEPS - 1

    LaunchedEffect(currentStep) {
        if (currentStep == 0) {
            isCoolingDown = false
            remainingSeconds = 0
        } else {
            isCoolingDown = true
            for (i in COOLDOWN_SECONDS downTo 1) {
                remainingSeconds = i
                kotlinx.coroutines.delay(1000L)
            }
            isCoolingDown = false
        }
    }

    BackHandler(enabled = currentStep > 0) {
        currentStep--
    }

    val onNext: () -> Unit = {
        if (isLastStep) {
            onFinish()
        } else {
            currentStep++
        }
    }

    val onPrevious: () -> Unit = {
        if (currentStep > 0) {
            currentStep--
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.surface,
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
                //.systemBarsPadding(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                if (isFirstStep) {
                    TextButton(onClick = onSkip) {
                        Text(
                            text = stringResource(R.string.onboarding_skip),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            StepIndicator(
                totalSteps = TOTAL_STEPS,
                currentStep = currentStep,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
            )

            AnimatedContent(
                targetState = currentStep,
                transitionSpec = {
                    if (targetState > initialState) {
                        slideInHorizontally(animationSpec = tween(300)) { it } +
                            fadeIn(animationSpec = tween(300)) togetherWith
                            slideOutHorizontally(animationSpec = tween(300)) { -it } +
                            fadeOut(animationSpec = tween(300))
                    } else {
                        slideInHorizontally(animationSpec = tween(300)) { -it } +
                            fadeIn(animationSpec = tween(300)) togetherWith
                            slideOutHorizontally(animationSpec = tween(300)) { it } +
                            fadeOut(animationSpec = tween(300))
                    }.using(SizeTransform(clip = false))
                },
                modifier = Modifier.weight(1f),
                label = "step_transition",
            ) { stepIndex ->
                when (stepIndex) {
                    0 -> WelcomeStep()
                    1 -> BasicConceptsStep()
                    2 -> ImageStep(
                        imageRes = R.drawable.mkpr,
                        titleRes = R.string.onboarding_title_step3,
                        descRes = R.string.onboarding_desc_step3,
                    )
                    3 -> ImageStep(
                        imageRes = R.drawable.mkprr,
                        titleRes = R.string.onboarding_title_step4,
                        descRes = R.string.onboarding_desc_step4,
                    )
                    4 -> TipsStep()
                }
            }

            BottomButtonBar(
                isFirstStep = isFirstStep,
                isLastStep = isLastStep,
                isCoolingDown = isCoolingDown,
                remainingSeconds = remainingSeconds,
                onNext = onNext,
                onPrevious = onPrevious,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 24.dp),
            )
        }
    }
}

@Composable
private fun StepIndicator(
    totalSteps: Int,
    currentStep: Int,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(totalSteps) { index ->
            val isActive = index == currentStep
            val dotWidth = if (isActive) 16.dp else 8.dp
            val dotColor = if (isActive) MaterialTheme.colorScheme.primary
                           else MaterialTheme.colorScheme.outlineVariant

            Box(
                modifier = Modifier
                    .padding(horizontal = 4.dp)
                    .width(dotWidth)
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(dotColor),
            )
        }
    }
}

@Composable
private fun WelcomeStep() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            painter = painterResource(id = R.drawable.ic_onboarding),
            contentDescription = stringResource(R.string.onboarding_app_icon),
            modifier = Modifier
                .size(160.dp)
                .clip(CircleShape),
            contentScale = androidx.compose.ui.layout.ContentScale.Fit,
        )

        Spacer(modifier = Modifier.height(32.dp))

        Text(
            text = stringResource(R.string.onboarding_title_step1),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = htmlStringResource(R.string.onboarding_desc_step1),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            lineHeight = 24.sp,
        )
    }
}

@Composable
private fun BasicConceptsStep() {
    Column(
        modifier = Modifier
            .fillMaxSize(),
    ) {
        Text(
            text = stringResource(R.string.onboarding_title_step2),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp, bottom = 8.dp),
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                horizontal = 24.dp,
                vertical = 8.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(qaItems, key = { it.question }) { item ->
                QaCard(
                    question = stringResource(item.question),
                    answer = htmlStringResource(item.answer),
                )
            }
            item {
                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun QaCard(
    question: String,
    answer: AnnotatedString,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
        ) {
            Text(
                text = question,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = answer,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 20.sp,
            )
        }
    }
}

@Composable
private fun TipsStep() {
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier.fillMaxSize(),
    ) {
        Text(
            text = stringResource(R.string.onboarding_title_step5),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp, bottom = 8.dp),
        )

        val lineColor = MaterialTheme.colorScheme.outlineVariant

        Box(
            modifier = Modifier.fillMaxSize(),
        ) {
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 24.dp),
            ) {
                val dashWidth = with(density) { 6.dp.toPx() }
                val gapWidth = with(density) { 4.dp.toPx() }
                val strokeW = with(density) { 1.5.dp.toPx() }
                val centerX = with(density) { 7.dp.toPx() }
                drawLine(
                    color = lineColor,
                    start = Offset(centerX, 0f),
                    end = Offset(centerX, size.height),
                    strokeWidth = strokeW,
                    pathEffect = PathEffect.dashPathEffect(
                        floatArrayOf(dashWidth, gapWidth)
                    ),
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState)
                    .padding(horizontal = 24.dp, vertical = 8.dp),
            ) {
                tipItems.forEachIndexed { index, item ->
                    TipRow(
                        title = stringResource(item.title),
                        body = htmlStringResource(item.body),
                    )
                    if (index < tipItems.size - 1) {
                        Spacer(modifier = Modifier.height(4.dp))
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun TipRow(
    title: String,
    body: AnnotatedString,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .width(14.dp)
                    .height(14.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary),
            )

            Spacer(modifier = Modifier.width(12.dp))

            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            lineHeight = 20.sp,
            modifier = Modifier.padding(start = 26.dp),
        )
    }
}

@Composable
private fun ImageStep(
    @androidx.annotation.DrawableRes imageRes: Int,
    @androidx.annotation.StringRes titleRes: Int,
    @androidx.annotation.StringRes descRes: Int,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = stringResource(titleRes),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = htmlStringResource(descRes),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(16.dp))

        Image(
            painter = painterResource(id = imageRes),
            contentDescription = stringResource(R.string.onboarding_step_image),
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentScale = androidx.compose.ui.layout.ContentScale.Fit,
        )

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun PlaceholderStep(
    @androidx.annotation.StringRes titleRes: Int,
    @androidx.annotation.StringRes descRes: Int,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = stringResource(titleRes),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = htmlStringResource(descRes),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun BottomButtonBar(
    isFirstStep: Boolean,
    isLastStep: Boolean,
    isCoolingDown: Boolean,
    remainingSeconds: Int,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(
            onClick = onPrevious,
            enabled = !isFirstStep,
            modifier = Modifier
                .weight(1f)
                .height(44.dp),
            shape = RoundedCornerShape(16.dp),
        ) {
            Text(
                text = stringResource(R.string.onboarding_previous),
            )
        }

        Spacer(modifier = Modifier.width(16.dp))

        Button(
            onClick = onNext,
            enabled = !isCoolingDown,
            modifier = Modifier
                .weight(1f)
                .height(44.dp),
            shape = RoundedCornerShape(16.dp),
        ) {
            Text(
                text = when {
                    isCoolingDown -> stringResource(
                        R.string.onboarding_cooldown, remainingSeconds
                    )
                    isLastStep -> stringResource(R.string.onboarding_finish)
                    else -> stringResource(R.string.onboarding_next)
                },
            )
        }
    }
}

// ============================================================================
// Previews
// ============================================================================

@Preview(showBackground = true, name = "Step 1 - Welcome")
@Composable
private fun PreviewWelcomeStep() {
    OnboardingTheme {
        Surface {
            WelcomeStep()
        }
    }
}

@Preview(showBackground = true, name = "Step 2 - Basic Concepts")
@Composable
private fun PreviewBasicConceptsStep() {
    OnboardingTheme {
        Surface {
            BasicConceptsStep()
        }
    }
}

@Preview(showBackground = true, name = "Step 3 - UI Intro")
@Composable
private fun PreviewImageStep3() {
    OnboardingTheme {
        Surface {
            ImageStep(
                imageRes = R.drawable.mkpr,
                titleRes = R.string.onboarding_title_step3,
                descRes = R.string.onboarding_desc_step3,
            )
        }
    }
}

@Preview(showBackground = true, name = "Step 4 - Basic Usage")
@Composable
private fun PreviewImageStep4() {
    OnboardingTheme {
        Surface {
            ImageStep(
                imageRes = R.drawable.mkprr,
                titleRes = R.string.onboarding_title_step4,
                descRes = R.string.onboarding_desc_step4,
            )
        }
    }
}

@Preview(showBackground = true, name = "Step 5 - Usage Tips")
@Composable
private fun PreviewTipsStep() {
    OnboardingTheme {
        Surface {
            TipsStep()
        }
    }
}

@Preview(
    showBackground = true,
    widthDp = 360,
    heightDp = 640,
    name = "Full Onboarding",
)
@Composable
private fun PreviewOnboarding() {
    OnboardingTheme {
        OnboardingScreen(
            onFinish = {},
            onSkip = {},
        )
    }
}
